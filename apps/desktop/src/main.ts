import { existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, systemPreferences } from "electron";
import { type FilmMeta, FilmLibrary } from "./films";
import { registerDslrIpc } from "./dslr/ipc";
import { registerRemoteIpc } from "./remote/ipc";
import { registerUpdates } from "./updates";

/** Gepetta Studio's logo: the renderer ships it (studio's public/logo.png). */
const APP_ICON = path.join(__dirname, "..", "renderer", "logo.png");
const DEV_URL = process.env.GEPETTA_DEV_URL;
const library = new FilmLibrary(path.join(app.getPath("documents"), "Gepetta Studio"));
let mainWindow: BrowserWindow | null = null;
const getWindow = () => mainWindow;
const disposers: (() => unknown)[] = [];
let releaseCameras: () => Promise<void> = async () => undefined;

function registerIpc() {
  ipcMain.handle("films:list", () => library.list());
  ipcMain.handle("films:load", (_e, id: string) => library.load(id));
  ipcMain.handle("films:save", (_e, id: string, meta: FilmMeta, json: string) => library.save(id, meta, json));
  ipcMain.handle("films:remove", (_e, id: string) => library.remove(id));
  ipcMain.handle("films:reveal", async (_e, id: string) => shell.openPath(await library.dirOf(id)));
  ipcMain.handle("assets:has", (_e, filmId: string, assetId: string) => library.hasAsset(filmId, assetId));
  ipcMain.handle("assets:put", (_e, filmId: string, assetId: string, mime: string, data: ArrayBuffer) =>
    library.putAsset(filmId, assetId, mime, data),
  );
  ipcMain.handle("assets:get", (_e, filmId: string, assetId: string) => library.getAsset(filmId, assetId));
  ipcMain.handle("file:save", async (e, defaultName: string, data: ArrayBuffer) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const result = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath("videos"), defaultName),
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, Buffer.from(data));
    return result.filePath;
  });
  // Exported files listed in a film's versions: still there? show them.
  ipcMain.handle("file:exists", async (_e, filePath: unknown) => {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
    return stat(filePath).then(
      (s) => s.isFile(),
      () => false,
    );
  });
  ipcMain.handle("file:reveal", (_e, filePath: unknown) => {
    if (typeof filePath === "string" && path.isAbsolute(filePath)) shell.showItemInFolder(filePath);
  });
  const dslr = registerDslrIpc(getWindow);
  releaseCameras = dslr.releaseCameras;
  disposers.push(registerRemoteIpc(getWindow).dispose, dslr.dispose);
}

/**
 * Electron's usual menu without zooming the whole window: Ctrl/⌘ with + − 0
 * zoom the big picture instead (the studio handles them). Developer tools stay.
 */
function setMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { label: "Ver", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
      { role: "windowMenu" },
    ]),
  );
}

function createWindow() {
  const win = (mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#1b1916",
    title: "Gepetta Studio",
    // The window's icon on Windows and Linux (the app's own icon comes from build/icon.png).
    ...(existsSync(APP_ICON) && { icon: APP_ICON }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  }));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    // On macOS the app outlives its window; the camera must not stay taken.
    void releaseCameras();
  });
  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  // While developing (not packaged) the Dock shows Electron's icon otherwise.
  if (process.platform === "darwin" && !app.isPackaged && existsSync(APP_ICON)) app.dock?.setIcon(APP_ICON);
  // Only the camera/microphone permission is granted to the renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("camera").catch(() => false);
  }
  registerIpc();
  disposers.push(registerUpdates(getWindow));
  setMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => disposers.forEach((d) => d()));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
