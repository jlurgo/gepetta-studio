import type { AssetId, History } from "@gepetta/core";
import type { Release } from "../state/releases";

export interface FilmMeta {
  id: string;
  name: string;
  updatedAt: number;
  /** Pictures in the film (clips; "frames" in films from before the grid). */
  frameCount: number;
  /** Thumbnail asset of the first picture. */
  thumb: AssetId | null;
}

export interface FilmFile {
  /** 1: frames in a row (before the grid timeline). 2: grid of cells and tracks. */
  version: 1 | 2;
  id: string;
  history: History;
  /** A version-1 film's original history, kept untouched when it was converted. */
  legacy?: History;
  /** Published versions, oldest first. */
  releases?: Release[];
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
