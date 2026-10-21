/** API exposed by the Electron preload script (apps/desktop/src/preload.ts). Absent in the browser. */
export interface NativeFilmMeta {
  id: string;
  name: string;
  updatedAt: number;
  frameCount: number;
  thumb: string | null;
}

export interface GepettaNative {
  platform: string;
  films: {
    list(): Promise<NativeFilmMeta[]>;
    load(id: string): Promise<string>;
    save(id: string, meta: NativeFilmMeta, json: string): Promise<void>;
    remove(id: string): Promise<void>;
    reveal(id: string): Promise<void>;
  };
  assets: {
    has(filmId: string, assetId: string): Promise<boolean>;
    put(filmId: string, assetId: string, mime: string, data: ArrayBuffer): Promise<void>;
    get(filmId: string, assetId: string): Promise<ArrayBuffer>;
  };
  saveFile(defaultName: string, data: ArrayBuffer): Promise<string | null>;
}

declare global {
  interface Window {
    gepetta?: GepettaNative;
  }
}
