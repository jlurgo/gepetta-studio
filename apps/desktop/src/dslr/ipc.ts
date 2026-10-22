import { type BrowserWindow, ipcMain } from "electron";
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

/** Errors reach the renderer as plain messages, so make sure they are Spanish. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DslrError) {
      if (err.detail) console.warn(`[dslr] ${err.code}: ${err.detail.trim()}`);
      throw new Error(err.message);
    }
    console.error("[dslr]", err);
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

  ipcMain.handle("dslr:status", () => guarded(() => driver.status()));
  ipcMain.handle("dslr:detect", () => guarded(() => driver.detect()));
  ipcMain.handle("dslr:open", (_e, id: string) =>
    guarded(() =>
      driver.open(
        id,
        (jpeg) => send("dslr:frame", id, jpeg),
        (message, code) => send("dslr:error", id, message, code),
      ),
    ),
  );
  ipcMain.handle("dslr:close", (_e, id: string) => guarded(() => driver.close(id)));
  ipcMain.handle("dslr:capture", (_e, id: string) => guarded(() => driver.capture(id)));
  ipcMain.handle("dslr:getControls", (_e, id: string) => guarded(() => driver.getControls(id)));
  ipcMain.handle("dslr:setControl", (_e, id: string, key: string, value: string) =>
    guarded(() => driver.setControl(id, key, String(value))),
  );
  ipcMain.handle("dslr:releaseUsb", () => guarded(() => driver.releaseUsb()));

  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      return driver.dispose();
    },
  };
}
