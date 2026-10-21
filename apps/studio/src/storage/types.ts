import type { AssetId, History } from "@gepetta/core";

export interface FilmMeta {
  id: string;
  name: string;
  updatedAt: number;
  frameCount: number;
  /** Thumbnail asset of the first frame. */
  thumb: AssetId | null;
}

export interface FilmFile {
  version: 1;
  id: string;
  history: History;
}

export interface StorageBackend {
  kind: "desktop" | "browser";
  listFilms(): Promise<FilmMeta[]>;
  loadFilm(id: string): Promise<FilmFile>;
  saveFilm(file: FilmFile, meta: FilmMeta): Promise<void>;
  deleteFilm(id: string): Promise<void>;
  hasAsset(filmId: string, assetId: AssetId): Promise<boolean>;
  putAsset(filmId: string, assetId: AssetId, blob: Blob): Promise<void>;
  getAsset(filmId: string, assetId: AssetId): Promise<Blob>;
  /** Shows the film folder in Finder/Explorer, when there is one. */
  reveal?(filmId: string): Promise<void>;
}
