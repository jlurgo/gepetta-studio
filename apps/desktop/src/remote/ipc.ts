import path from "node:path";
import type { DesktopMessage } from "@gepetta/protocol";
import { type BrowserWindow, app, ipcMain } from "electron";
import { RemoteServer } from "./server";
import { UsbError, connectUsbPhones, releaseUsbPhones } from "./usb";

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
  ipcMain.handle("remote:stop", async () => {
    await releaseUsbPhones().catch(() => undefined);
    await server.stop();
  });
  // Android phones on the USB cable: the server starts (also without a network) and each phone opens the camera page.
  ipcMain.handle("remote:usb", async () => {
    try {
      const { port, url } = await server.usbTarget();
      const phones = await connectUsbPhones([port], url);
      return { info: await server.start(true), phones };
    } catch (e) {
      if (!(e instanceof UsbError)) console.error("[gepetta] usb phone", e);
      throw new Error(e instanceof UsbError ? e.message : "No se pudo conectar el celular por USB.");
    }
  });
  ipcMain.handle("remote:send", (_e, sessionId: string, header: DesktopMessage, payload: Uint8Array | null) =>
    server.send(sessionId, header, payload),
  );
  return { dispose: () => server.stop() };
}
