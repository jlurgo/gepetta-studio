import type { AssetId, FilmState, TrackId } from "@gepetta/core";
import type { VideoFormat, VideoQuality } from "../export/video";
import { storage } from "../storage";

/**
 * A published version of the film: an export marked as a release. It keeps
 * the film as it was (to export it again later, whatever changed since), the
 * export options and where the file went.
 */
export interface Release {
  id: string;
  /** "1.0", "1.1", "2.0"… or whatever was typed. */
  version: string;
  title: string;
  notes: string;
  createdAt: number;
  /** History step the film was at, to mark it in the history panel. */
  entryId: string | null;
  /** The film as it was, stored as a JSON asset of the film. */
  snapshot: AssetId;
  export: {
    format: VideoFormat;
    quality: VideoQuality;
    width: number;
    height: number;
    /** Only these tracks; all exported tracks when missing. */
    tracks?: TrackId[];
  };
  /** The exported file: its name, and on desktop where it was saved. */
  file: { name: string; path: string | null; size: number } | null;
}

/** Numbers to offer for the next release: a new version, or a revision of the last one. */
export function nextVersions(releases: Release[]): { major: string; minor: string } {
  let major = 0;
  let minor = -1;
  for (const r of releases) {
    const m = /^(\d+)(?:\.(\d+))?/.exec(r.version);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] ?? 0);
    if (a > major || (a === major && b > minor)) {
      major = a;
      minor = b;
    }
  }
  if (major === 0) return { major: "1.0", minor: "1.0" };
  return { major: `${major + 1}.0`, minor: `${major}.${minor + 1}` };
}

async function sha256(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores the film as it is now with the film's assets; returns its id. */
export async function snapshotFilm(filmId: string, film: FilmState): Promise<AssetId> {
  const blob = new Blob([JSON.stringify(film)], { type: "application/json" });
  const id = await sha256(await blob.arrayBuffer());
  if (!(await storage.hasAsset(filmId, id))) await storage.putAsset(filmId, id, blob);
  return id;
}

export async function loadSnapshot(filmId: string, snapshot: AssetId): Promise<FilmState> {
  return JSON.parse(await (await storage.getAsset(filmId, snapshot)).text()) as FilmState;
}

/** Whether a release's file is still where it was saved: true/false on desktop, null when unknowable (browser). */
export async function fileStillThere(release: Release): Promise<boolean | null> {
  const path = release.file?.path;
  if (!path || !window.gepetta) return null;
  return window.gepetta.fileExists(path);
}
