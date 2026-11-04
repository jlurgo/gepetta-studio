import { type BrowserWindow, ipcMain } from "electron";
import { videoId } from "./youtubeLink";

/**
 * Downloading a video file from a link (a direct link to an .mp4, a .webm…,
 * or a Google Drive file shared by link), to import it as a video chosen
 * from disk. Pages are not videos: a YouTube page, for one, says so.
 */
const MAX_BYTES = 2 * 1024 ** 3;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|avi)(?:$|[?#])/i;

export class LinkError extends Error {}

/** Google Drive's own download address for a file shared by link. */
function driveDownload(url: URL): string | null {
  if (url.hostname !== "drive.google.com") return null;
  const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get("id");
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : null;
}

export async function downloadVideo(link: string, progress: (received: number, total: number) => void): Promise<{ name: string; mime: string; data: ArrayBuffer }> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new LinkError("Eso no es un link: tiene que empezar con https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkError("El link tiene que empezar con https://");
  if (videoId(link)) throw new LinkError("Es un link de YouTube: pegalo en «Video de internet» y tocá «Buscar»; desde el resultado lo podés bajar e importar.");
  const res = await fetch(driveDownload(url) ?? url.href, { redirect: "follow" });
  if (!res.ok) throw new LinkError(`No se pudo bajar (el servidor respondió ${res.status}).`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const disposition = res.headers.get("content-disposition") ?? "";
  const named = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "");
  const last = decodeURIComponent(new URL(res.url).pathname.split("/").pop() ?? "");
  const given = named || last;
  // A video by its type, or (a server that does not say) by its name.
  const isVideo = mime.startsWith("video/") || (!mime.startsWith("text/") && VIDEO_EXT.test(given));
  const name = isVideo && VIDEO_EXT.test(given) ? given : "video de internet.mp4";
  if (!isVideo) {
    await res.body?.cancel();
    throw new LinkError(mime.startsWith("text/html") ? "El link lleva a una página, no a un archivo de video. Buscá el link de descarga del video." : "Lo que hay en ese link no es un video.");
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total > MAX_BYTES) throw new LinkError("El video es demasiado grande (más de 2 GB).");
  const chunks: Uint8Array[] = [];
  let received = 0;
  let shown = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    received += chunk.length;
    if (received > MAX_BYTES) throw new LinkError("El video es demasiado grande (más de 2 GB).");
    if (received - shown > 256 * 1024) {
      shown = received;
      progress(received, total);
    }
  }
  progress(received, total);
  const data = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    data.set(c, at);
    at += c.length;
  }
  return { name, mime: mime.startsWith("video/") ? mime : "video/mp4", data: data.buffer };
}

export function registerVideoLinkIpc(getWindow: () => BrowserWindow | null) {
  ipcMain.handle("video:download", async (_e, link: unknown) => {
    if (typeof link !== "string") throw new LinkError("Falta el link.");
    try {
      return await downloadVideo(link, (received, total) => getWindow()?.webContents.send("video:progress", received, total));
    } catch (e) {
      // Only the message crosses to the window, in Spanish when it is ours.
      throw new Error(e instanceof LinkError ? e.message : "No se pudo bajar el video: fijate que el link ande y que haya internet.");
    }
  });
}
