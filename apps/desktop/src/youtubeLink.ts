/** The video's id in a YouTube link (or an id on its own). */
export function videoId(text: string): string | null {
  const t = text.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1]! : null;
}
