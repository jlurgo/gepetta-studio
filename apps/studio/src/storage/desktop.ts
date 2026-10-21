import type { GepettaNative } from "../native";
import type { StorageBackend } from "./types";

/** Film folders on disk, through the Electron preload bridge. */
export function desktopStorage(native: GepettaNative): StorageBackend {
  return {
    kind: "desktop",
    listFilms: () => native.films.list(),
    async loadFilm(id) {
      return JSON.parse(await native.films.load(id));
    },
    saveFilm: (file, meta) => native.films.save(file.id, meta, JSON.stringify(file)),
    deleteFilm: (id) => native.films.remove(id),
    hasAsset: (filmId, assetId) => native.assets.has(filmId, assetId),
    async putAsset(filmId, assetId, blob) {
      await native.assets.put(filmId, assetId, blob.type, await blob.arrayBuffer());
    },
    async getAsset(filmId, assetId) {
      return new Blob([await native.assets.get(filmId, assetId)]);
    },
    reveal: (filmId) => native.films.reveal(filmId),
  };
}
