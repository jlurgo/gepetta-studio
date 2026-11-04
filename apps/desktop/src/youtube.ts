import { ipcMain, shell } from "electron";
import { Innertube } from "youtubei.js";
import { videoId } from "./youtubeLink";

/**
 * Looking for videos on YouTube from the app (a search, or a pasted link),
 * to watch them in the browser. The app does not download them: that is up
 * to whoever has the right to, and the file is imported as any other video.
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

let client: Promise<Innertube> | null = null;

function youtube(): Promise<Innertube> {
  client ??= Innertube.create({ retrieve_player: false });
  client.catch(() => (client = null));
  return client;
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

export function registerYouTubeIpc() {
  ipcMain.handle("youtube:search", (_e, query: unknown) => (typeof query === "string" && query.trim() ? searchYouTube(query) : []));
  // Only YouTube's own page for that video, never another address.
  ipcMain.handle("youtube:open", (_e, id: unknown) => {
    if (typeof id === "string" && /^[\w-]{11}$/.test(id)) return shell.openExternal(`https://www.youtube.com/watch?v=${id}`);
  });
}
