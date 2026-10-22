import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Shape must match GepettaNative in apps/studio/src/native.d.ts.

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("gepetta", {
  platform: process.platform,
  films: {
    list: () => ipcRenderer.invoke("films:list"),
    load: (id: string) => ipcRenderer.invoke("films:load", id),
    save: (id: string, meta: unknown, json: string) => ipcRenderer.invoke("films:save", id, meta, json),
    remove: (id: string) => ipcRenderer.invoke("films:remove", id),
    reveal: (id: string) => ipcRenderer.invoke("films:reveal", id),
  },
  assets: {
    has: (filmId: string, assetId: string) => ipcRenderer.invoke("assets:has", filmId, assetId),
    put: (filmId: string, assetId: string, mime: string, data: ArrayBuffer) =>
      ipcRenderer.invoke("assets:put", filmId, assetId, mime, data),
    get: (filmId: string, assetId: string) => ipcRenderer.invoke("assets:get", filmId, assetId),
  },
  saveFile: (defaultName: string, data: ArrayBuffer) => ipcRenderer.invoke("file:save", defaultName, data),
  remote: {
    start: () => ipcRenderer.invoke("remote:start"),
    stop: () => ipcRenderer.invoke("remote:stop"),
    send: (sessionId: string, header: unknown, payload?: Uint8Array | null) =>
      ipcRenderer.invoke("remote:send", sessionId, header, payload ?? null),
    onEvent: (cb: (e: unknown) => void) => subscribe("remote:event", cb),
  },
  dslr: {
    status: () => ipcRenderer.invoke("dslr:status"),
    detect: () => ipcRenderer.invoke("dslr:detect"),
    open: (id: string) => ipcRenderer.invoke("dslr:open", id),
    close: (id: string) => ipcRenderer.invoke("dslr:close", id),
    capture: (id: string) => ipcRenderer.invoke("dslr:capture", id),
    getControls: (id: string) => ipcRenderer.invoke("dslr:getControls", id),
    setControl: (id: string, key: string, value: string) => ipcRenderer.invoke("dslr:setControl", id, key, value),
    releaseUsb: () => ipcRenderer.invoke("dslr:releaseUsb"),
    onFrame: (cb: (id: string, jpeg: Uint8Array) => void) => subscribe("dslr:frame", cb),
    onError: (cb: (id: string, message: string, code: string) => void) => subscribe("dslr:error", cb),
  },
});
