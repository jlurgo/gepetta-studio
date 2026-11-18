import path from "node:path";

const KINDS: Record<string, string> = {
  ".mp4": "Video MP4",
  ".webm": "Video WebM",
  ".gif": "GIF animado",
  ".png": "Imagen PNG",
  ".jpg": "Imagen JPEG",
  ".pdf": "PDF",
  ".zip": "Archivo ZIP",
  ".wav": "Sonido WAV",
};

/** The file type to offer in a save dialog for a file named like `defaultName` (none when it has no extension). */
export function saveFilters(defaultName: string): { name: string; extensions: string[] }[] {
  const ext = path.extname(defaultName).toLowerCase();
  return ext ? [{ name: KINDS[ext] ?? `Archivo ${ext.slice(1).toUpperCase()}`, extensions: [ext.slice(1)] }] : [];
}

/**
 * The path chosen in a save dialog, with the extension of `defaultName` when
 * the name typed there lost it (on Windows a retyped name comes without one,
 * and the file then opens with nothing).
 */
export function withExtension(chosen: string, defaultName: string): string {
  const ext = path.extname(defaultName);
  if (!ext || path.extname(chosen).toLowerCase() === ext.toLowerCase()) return chosen;
  return chosen.replace(/\.+$/, "") + ext;
}
