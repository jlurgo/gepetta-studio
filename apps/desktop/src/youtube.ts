import { type BrowserWindow, ipcMain, shell } from "electron";
import { Innertube } from "youtubei.js";
import { videoId } from "./youtubeLink";
import { YtDlpError, downloadYouTube } from "./ytdlp";

/**
 * Looking for videos on YouTube from the app (a search, or a pasted link) to
 * watch them in the browser, and downloading one (with yt-dlp, see ytdlp.ts)
 * to import it as any other video. Downloading is up to whoever has the right
 * to use the video.
 */
export interface YouTubeVideo {
  id: string;
  title: string;
  channel: string;
  /** Seconds (0 when unknown, e.g. a live). */
  duration: number;
  /** A small picture of it (a data: URL), when there is one. */
  thumb: string | null;
}

/** An error whose (Spanish) message is meant to be shown to the user. */
export class YouTubeError extends Error {}

// Searching does not need the player, so it is turned off (faster to start).
let searchClient: Promise<Innertube> | null = null;

function youtube(): Promise<Innertube> {
  searchClient ??= Innertube.create({ retrieve_player: false });
  searchClient.catch(() => (searchClient = null));
  return searchClient;
}

async function thumbData(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The smallest thumbnail at least 160 px wide (or the biggest there is). */
function pickThumb(thumbs: { url: string; width: number }[] | undefined): string | undefined {
  const list = [...(thumbs ?? [])].sort((a, b) => a.width - b.width);
  return (list.find((t) => t.width >= 160) ?? list.at(-1))?.url;
}

export async function searchYouTube(query: string): Promise<YouTubeVideo[]> {
  const yt = await youtube();
  const id = videoId(query);
  if (id) {
    const info = await yt.getBasicInfo(id);
    const b = info.basic_info;
    return [{ id, title: b.title ?? id, channel: b.author ?? "", duration: b.duration ?? 0, thumb: await thumbData(pickThumb(b.thumbnail)) }];
  }
  const found = await yt.search(query, { type: "video" });
  const videos = found.videos
    .filter((v) => "id" in v && typeof v.id === "string")
    .slice(0, 20)
    .map((v) => {
      const video = v as unknown as { id: string; title?: { toString(): string }; author?: { name?: string }; duration?: { seconds?: number }; thumbnails?: { url: string; width: number }[] };
      return { id: video.id, title: video.title?.toString() ?? video.id, channel: video.author?.name ?? "", duration: video.duration?.seconds ?? 0, thumb: pickThumb(video.thumbnails) };
    });
  return Promise.all(videos.map(async (v) => ({ ...v, thumb: await thumbData(v.thumb) })));
}

/**
 * A quick, best-effort check before handing a video to yt-dlp: a live stream
 * has no fixed file to download, so stop early with a clear message instead of
 * starting a download that never ends. Anything else is left to yt-dlp.
 */
async function assertDownloadable(id: string): Promise<void> {
  try {
    const yt = await youtube();
    const b = (await yt.getBasicInfo(id)).basic_info;
    if (b.is_live || b.is_upcoming) throw new YouTubeError("Es una transmisión en vivo: no se puede bajar como archivo de video.");
  } catch (e) {
    if (e instanceof YouTubeError) throw e;
    // Could not check (no internet, YouTube changed): let yt-dlp try and report.
  }
}

export function registerYouTubeIpc(getWindow: () => BrowserWindow | null) {
  ipcMain.handle("youtube:search", (_e, query: unknown) => (typeof query === "string" && query.trim() ? searchYouTube(query) : []));
  // Only YouTube's own page for that video, never another address.
  ipcMain.handle("youtube:open", (_e, id: unknown, at?: unknown) => {
    const t = typeof at === "number" && Number.isFinite(at) && at > 0 ? `&t=${Math.floor(at)}s` : "";
    if (typeof id === "string" && /^[\w-]{11}$/.test(id)) return shell.openExternal(`https://www.youtube.com/watch?v=${id}${t}`);
  });
  ipcMain.handle("youtube:download", async (_e, id: unknown, section?: unknown) => {
    if (typeof id !== "string") throw new YouTubeError("Falta el video.");
    const s = section as { from?: unknown; to?: unknown } | undefined;
    const stretch = s && typeof s.from === "number" && typeof s.to === "number" ? { from: s.from, to: s.to } : undefined;
    const send = (channel: string, ...args: unknown[]) => getWindow()?.webContents.send(channel, ...args);
    try {
      await assertDownloadable(id);
      return await downloadYouTube(
        id,
        (received, total, unit) => send("youtube:progress", received, total, unit),
        (msg) => send("youtube:status", msg),
        stretch,
      );
    } catch (e) {
      // Only the message crosses to the window, in Spanish when it is ours.
      const ours = e instanceof YouTubeError || e instanceof YtDlpError;
      if (!ours) console.error("[gepetta] youtube download", e);
      throw new Error(ours ? (e as Error).message : "No se pudo bajar el video de YouTube: fijate que haya internet e intentá de nuevo.");
    }
  });
}
