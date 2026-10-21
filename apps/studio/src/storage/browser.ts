import { openDB, type DBSchema } from "idb";
import type { FilmFile, FilmMeta, StorageBackend } from "./types";

interface Schema extends DBSchema {
  films: { key: string; value: FilmFile };
  meta: { key: string; value: FilmMeta };
  assets: { key: [string, string]; value: { filmId: string; assetId: string; blob: Blob }; indexes: { film: string } };
}

const db = () =>
  openDB<Schema>("gepetta-studio", 1, {
    upgrade(d) {
      d.createObjectStore("films", { keyPath: "id" });
      d.createObjectStore("meta", { keyPath: "id" });
      d.createObjectStore("assets", { keyPath: ["filmId", "assetId"] }).createIndex("film", "filmId");
    },
  });

/** IndexedDB storage, used when running in a plain browser. */
export function browserStorage(): StorageBackend {
  const open = db();
  return {
    kind: "browser",
    async listFilms() {
      return (await open).getAll("meta");
    },
    async loadFilm(id) {
      const file = await (await open).get("films", id);
      if (!file) throw new Error(`Película ${id} no encontrada`);
      return file;
    },
    async saveFilm(file, meta) {
      const tx = (await open).transaction(["films", "meta"], "readwrite");
      await Promise.all([tx.objectStore("films").put(file), tx.objectStore("meta").put(meta), tx.done]);
    },
    async deleteFilm(id) {
      const d = await open;
      const tx = d.transaction(["films", "meta", "assets"], "readwrite");
      const keys = await tx.objectStore("assets").index("film").getAllKeys(id);
      await Promise.all([
        tx.objectStore("films").delete(id),
        tx.objectStore("meta").delete(id),
        ...keys.map((k) => tx.objectStore("assets").delete(k)),
        tx.done,
      ]);
    },
    async hasAsset(filmId, assetId) {
      return (await (await open).count("assets", [filmId, assetId])) > 0;
    },
    async putAsset(filmId, assetId, blob) {
      await (await open).put("assets", { filmId, assetId, blob });
    },
    async getAsset(filmId, assetId) {
      const row = await (await open).get("assets", [filmId, assetId]);
      if (!row) throw new Error(`Falta el archivo ${assetId}`);
      return row.blob;
    },
  };
}
