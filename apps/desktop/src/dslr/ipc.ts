import { appendFile } from "node:fs/promises";
import path from "node:path";
import { type BrowserWindow, app, ipcMain } from "electron";
import { createGphoto2Driver } from "./gphoto2";
import { DslrError, type DslrDriver } from "./types";

const CHANNELS = [
  "dslr:status",
  "dslr:detect",
  "dslr:open",
  "dslr:close",
  "dslr:capture",
  "dslr:getControls",
  "dslr:setControl",
  "dslr:releaseUsb",
] as const;

/** Camera problems go to the console and to <logs>/dslr.log, where they can be read after the fact. */
function log(channel: string, text: string) {
  const line = `${new Date().toISOString()} ${channel} ${text.trim()}\n`;
  console.warn(`[dslr] ${line.trim()}`);
  void appendFile(path.join(app.getPath("logs"), "dslr.log"), line).catch(() => undefined);
}

/** Errors reach the renderer as plain messages, so make sure they are Spanish. */
async function guarded<T>(channel: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DslrError) {
      log(channel, `${err.code}: ${err.message} | ${err.detail}`);
      throw new Error(err.message);
    }
    log(channel, String(err instanceof Error ? err.stack : err));
    throw new Error("Algo falló con la cámara réflex. Probá de nuevo.");
  }
}

/**
 * Exposes the DSLR driver to the renderer (see GepettaNative.dslr). Live-view
 * frames go out as 'dslr:frame' (id, jpeg) and failures as 'dslr:error'
 * (id, message, code). Call dispose() on quit so gphoto2 releases the camera.
 */
export function registerDslrIpc(
  getWindow: () => BrowserWindow | null,
  driver: DslrDriver = createGphoto2Driver(),
): { dispose(): Promise<void> } {
  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
  };

  ipcMain.handle("dslr:status", () =>
    guarded("dslr:status", () => driver.status()));
  ipcMain.handle("dslr:detect", () =>
    guarded("dslr:detect", () => driver.detect()));
  ipcMain.handle("dslr:open", (_e, id: string) =>
    guarded("dslr:open", () =>
      driver.open(
        id,
        (jpeg) => send("dslr:frame", id, jpeg),
        (message, code) => {
          log("dslr:live", `${code}: ${message}`);
          send("dslr:error", id, message, code);
        },
      ),
    ),
  );
  ipcMain.handle("dslr:close", (_e, id: string) =>
    guarded("dslr:close", () => driver.close(id)));
  ipcMain.handle("dslr:capture", (_e, id: string) =>
    guarded("dslr:capture", () => driver.capture(id)));
  ipcMain.handle("dslr:getControls", (_e, id: string) =>
    guarded("dslr:getControls", () => driver.getControls(id)));
  ipcMain.handle("dslr:setControl", (_e, id: string, key: string, value: string) =>
    guarded("dslr:setControl", () => driver.setControl(id, key, String(value))),
  );
  ipcMain.handle("dslr:releaseUsb", () =>
    guarded("dslr:releaseUsb", () => driver.releaseUsb()));

  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      return driver.dispose();
    },
  };
}
