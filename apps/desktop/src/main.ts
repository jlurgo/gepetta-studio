import { writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain, session, shell, systemPreferences } from "electron";
import { type FilmMeta, FilmLibrary } from "./films";

const DEV_URL = process.env.GEPETTA_DEV_URL;
const library = new FilmLibrary(path.join(app.getPath("documents"), "Gepetta Studio"));

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
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#1b1916",
    title: "Gepetta Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
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
  // Only the camera/microphone permission is granted to the renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("camera").catch(() => false);
  }
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
