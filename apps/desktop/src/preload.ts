import { contextBridge, ipcRenderer } from "electron";

// Shape must match GepettaNative in apps/studio/src/native.d.ts.
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
});
