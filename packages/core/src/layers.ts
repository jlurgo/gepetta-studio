import type { Channel, FilmState, Frame, FrameId, LayerId, MediaRef, Transform2D } from "./model";
import { timeline } from "./timing";

/** One picture to draw, bottom to top, with where it came from. */
export interface StackItem {
  key: string;
  media: MediaRef;
  opacity: number;
  transform: Transform2D;
  layerId?: LayerId;
  channelId?: LayerId;
}

/** Ticks each frame occupies: [start, end). */
export type FrameSpans = Map<FrameId, { start: number; end: number }>;

export function frameSpans(film: FilmState): FrameSpans {
  const spans: FrameSpans = new Map();
  for (const t of timeline(film).frames) spans.set(t.frame.id, { start: t.start, end: t.start + t.frame.hold });
  return spans;
}

/** Ticks a channel covers: [start, end). A sequence ends with its last picture unless `to` cuts it earlier. */
export function channelSpan(film: FilmState, channel: Channel, spans: FrameSpans): { start: number; end: number } {
  const start = channel.from ? (spans.get(channel.from)?.start ?? 0) : 0;
  let end = channel.to ? (spans.get(channel.to)?.end ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
  if (channel.source.kind === "sequence") {
    const length = Math.ceil((channel.source.media.length * film.settings.fps) / channel.source.fps);
    end = Math.min(end, start + length);
  }
  return { start, end };
}

/** The channel's picture at `tick`, or null when the channel is not on then. */
export function channelMediaAt(film: FilmState, channel: Channel, tick: number, spans: FrameSpans): MediaRef | null {
  const { start, end } = channelSpan(film, channel, spans);
  if (tick < start || tick >= end) return null;
  const source = channel.source;
  if (source.kind === "image") return source.media;
  const i = Math.floor(((tick - start) * source.fps) / film.settings.fps + 1e-9);
  return source.media[i] ?? null;
}

export interface StackOptions {
  /** Leave out reference-only channels (for export). */
  exportOnly?: boolean;
  /** Precomputed frameSpans(film), when drawing many frames. */
  spans?: FrameSpans;
}

/**
 * Everything visible at `tick`: channels below, the frame's own layers, channels
 * above. `frame` is null for the live view, where only channels show (at the
 * tick where the next picture will go).
 */
export function frameStack(film: FilmState, frame: Frame | null, tick: number, options: StackOptions = {}): StackItem[] {
  const spans = options.spans ?? frameSpans(film);
  const channelItems = (placement: Channel["placement"]): StackItem[] =>
    film.channels.flatMap((c) => {
      if (!c.visible || c.placement !== placement || (options.exportOnly && !c.exported)) return [];
      const media = channelMediaAt(film, c, tick, spans);
      return media ? [{ key: `c:${c.id}`, media, opacity: c.opacity, transform: c.transform, channelId: c.id }] : [];
    });
  const own: StackItem[] = (frame?.layers ?? [])
    .filter((l) => l.visible)
    .map((l) => ({ key: `l:${l.id}`, media: l.media, opacity: l.opacity, transform: l.transform, layerId: l.id }));
  return [...channelItems("below"), ...own, ...channelItems("above")];
}
