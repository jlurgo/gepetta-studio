import { type BrowserWindow, app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * Updates from the GitHub releases of jlurgo/gepetta-studio (see "publish" in
 * package.json). Windows only: macOS refuses to update an unsigned app.
 *
 * The new version downloads in the background and installs when the app
 * closes; the renderer can offer to restart right away. Errors (no internet
 * in the workshop, GitHub down) are ignored: the next start tries again.
 */

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export function registerUpdates(getWindow: () => BrowserWindow | null): () => void {
  let ready: string | null = null;
  ipcMain.handle("update:pending", () => ready);
  ipcMain.handle("update:install", () => {
    if (ready) autoUpdater.quitAndInstall(true, true);
  });
  if (!app.isPackaged || process.platform !== "win32") return () => undefined;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    ready = info.version;
    getWindow()?.webContents.send("update:ready", info.version);
  });
  autoUpdater.on("error", (err) => console.warn("update check failed:", err.message));

  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
