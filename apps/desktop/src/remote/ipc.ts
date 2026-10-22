import path from "node:path";
import type { DesktopMessage } from "@gepetta/protocol";
import { type BrowserWindow, app, ipcMain } from "electron";
import { RemoteServer } from "./server";

/** Where the built phone page lives: copied next to the app when packaged, the workspace build in dev. */
function phoneDir() {
  return app.isPackaged ? path.join(__dirname, "..", "phone") : path.join(__dirname, "..", "..", "phone", "dist");
}

export function registerRemoteIpc(getWindow: () => BrowserWindow | null): { dispose(): Promise<void> } {
  const server = new RemoteServer({
    certDir: path.join(app.getPath("userData"), "certs"),
    phoneDir: phoneDir(),
    onEvent: (e) => getWindow()?.webContents.send("remote:event", e),
  });
  ipcMain.handle("remote:start", () => server.start());
  ipcMain.handle("remote:stop", () => server.stop());
  ipcMain.handle("remote:send", (_e, sessionId: string, header: DesktopMessage, payload: Uint8Array | null) =>
    server.send(sessionId, header, payload),
  );
  return { dispose: () => server.stop() };
}
