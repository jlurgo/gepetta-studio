import { browserStorage } from "./browser";
import { desktopStorage } from "./desktop";
import type { StorageBackend } from "./types";

export type { FilmFile, FilmMeta, StorageBackend } from "./types";

export const storage: StorageBackend = window.gepetta ? desktopStorage(window.gepetta) : browserStorage();

export function saveBlob(blob: Blob, name: string): Promise<string | null> {
  if (window.gepetta) return blob.arrayBuffer().then((data) => window.gepetta!.saveFile(name, data));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return Promise.resolve(name);
}
