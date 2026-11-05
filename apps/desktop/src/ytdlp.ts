import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { app } from "electron";
import { ensureFfmpeg, lastTime } from "./ffmpeg";

/**
 * Downloading YouTube videos with yt-dlp (github.com/yt-dlp/yt-dlp). YouTube
 * no longer serves most videos in a format a plain in-app fetch can grab, so
 * the app leans on yt-dlp, which keeps up with YouTube's changes. The binary
 * is self-contained (no Python needed): it's fetched the first time it's used
 * and kept under the app's data folder, and refreshed once a day.
 */
export class YtDlpError extends Error {}

const ASSET = process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
const BIN_NAME = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 ** 3;

const toolsDir = () => path.join(app.getPath("userData"), "tools");
const binPath = () => path.join(toolsDir(), BIN_NAME);
const stampPath = () => path.join(toolsDir(), "yt-dlp.updated");

async function fetchBinary(): Promise<void> {
  await mkdir(toolsDir(), { recursive: true });
  const res = await fetch(RELEASE_URL, { redirect: "follow" });
  if (!res.ok || !res.body) throw new YtDlpError(`No se pudo bajar la herramienta para YouTube (el servidor respondió ${res.status}).`);
  const tmp = `${binPath()}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp);
    Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>)
      .pipe(out)
      .on("finish", () => resolve())
      .on("error", reject);
  });
  if (process.platform !== "win32") await chmod(tmp, 0o755);
  await rename(tmp, binPath());
  await writeFile(stampPath(), String(Date.now()));
}

/** Self-update at most once a day, in the background; failures are ignored. */
function maybeUpdate(bin: string): void {
  void (async () => {
    try {
      const last = Number(await readFile(stampPath(), "utf8").catch(() => "0"));
      if (Date.now() - last < UPDATE_EVERY_MS) return;
      await writeFile(stampPath(), String(Date.now())); // don't retry for a day even if it fails
      await new Promise<void>((resolve) => {
        const p = spawn(bin, ["-U"], { stdio: "ignore", windowsHide: true });
        p.on("close", () => resolve());
        p.on("error", () => resolve());
      });
    } catch {
      /* best effort */
    }
  })();
}

/** Makes sure yt-dlp is there (downloading it the first time), and returns its path. */
export async function ensureYtDlp(status?: (msg: string) => void): Promise<string> {
  if (existsSync(binPath())) {
    maybeUpdate(binPath());
  } else {
    status?.("Preparando por primera vez (bajando una herramienta chica, puede tardar un minuto)…");
    await fetchBinary();
  }
  return binPath();
}

const toInt = (s: string | undefined) => {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : 0;
};

/** Turns yt-dlp's error output into a short message for the user. */
function describeError(stderr: string): string {
  const e = stderr.toLowerCase();
  if (/private video/.test(e)) return "Ese video es privado: no se puede bajar.";
  if (/age|inappropriate|confirm your age|sign in to confirm/.test(e)) return "Ese video tiene restricción de edad: la app no puede bajarlo.";
  if (/this live event|is live|premieres in|live stream/.test(e)) return "Es una transmisión en vivo: no se puede bajar como archivo de video.";
  if (/not available in your country|geo|blocked it in your country/.test(e)) return "Ese video no está disponible en tu país.";
  if (/video unavailable|has been removed|no longer available|not available|account.*terminated/.test(e)) return "Ese video no está disponible (puede estar borrado o bloqueado).";
  if (/requested format is not available|no video formats/.test(e)) return "Ese video no viene en un formato que la app pueda bajar.";
  return "No se pudo bajar el video de YouTube. Probá de nuevo, y fijate que el link ande y que haya internet.";
}

function runYtDlp(bin: string, args: string[], cwd: string, onProgress: (received: number, total: number) => void, onTime?: (seconds: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd, windowsHide: true });
    } catch {
      reject(new YtDlpError("No se pudo ejecutar la herramienta para YouTube."));
      return;
    }
    let stderr = "";
    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("PROG ")) {
          const [, d, t, te] = line.split(" ");
          onProgress(toInt(d), toInt(t) || toInt(te));
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      // Downloading a stretch, ffmpeg tells how far it got.
      const t = onTime ? lastTime(chunk.toString()) : null;
      if (t !== null) onTime!(t);
      stderr += chunk.toString();
      if (stderr.length > 16384) stderr = stderr.slice(-16384);
    });
    child.on("error", () => reject(new YtDlpError("No se pudo ejecutar la herramienta para YouTube.")));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        console.error("[gepetta] yt-dlp failed", code, stderr.slice(-2000));
        reject(new YtDlpError(describeError(stderr)));
      }
    });
  });
}

/**
 * Downloads a YouTube video as a single .mp4 (H.264 up to 720p, image only —
 * enough to trace over or pull frames from, and no muxing needed), reporting
 * how far it got.
 */
export async function downloadYouTube(
  id: string,
  onProgress: (received: number, total: number, unit?: "s") => void,
  onStatus: (msg: string) => void,
  /** Only this stretch (seconds), cut with ffmpeg. */
  section?: { from: number; to: number },
): Promise<{ name: string; mime: string; data: ArrayBuffer }> {
  if (!/^[\w-]{11}$/.test(id)) throw new YtDlpError("No se reconoce ese video de YouTube.");
  if (section && !(Number.isFinite(section.from) && Number.isFinite(section.to) && section.to > section.from && section.from >= 0)) throw new YtDlpError("Ese tramo no sirve: el fin tiene que ir después del inicio.");
  const bin = await ensureYtDlp(onStatus);
  const ffmpeg = section ? await ensureFfmpeg(onStatus) : null;
  const work = path.join(app.getPath("userData"), "yt-tmp", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(work, { recursive: true });
  try {
    onStatus(section ? "Bajando el tramo de YouTube…" : "Bajando el video de YouTube…");
    const args = [
      // Prefer H.264 mp4 up to 720p, as a single file (no audio track, no ffmpeg needed).
      "-f",
      "bv*[vcodec~='^avc'][height<=?720][protocol^=https][ext=mp4]/bv*[height<=?720][protocol^=https][ext=mp4]/b[height<=?720][ext=mp4]/b[ext=mp4]/b",
      "--no-playlist",
      "--no-part",
      "--no-cache-dir",
      "--no-warnings",
      "--max-filesize",
      "2G",
      ...(section && ffmpeg ? ["--download-sections", `*${section.from}-${section.to}`, "--ffmpeg-location", ffmpeg] : []),
      "--newline",
      "--progress-template",
      "PROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
      "-o",
      path.join(work, "video.%(ext)s"),
      `https://www.youtube.com/watch?v=${id}`,
    ];
    const length = section ? section.to - section.from : 0;
    await runYtDlp(bin, args, work, section ? () => {} : onProgress, section ? (t) => onProgress(Math.min(t, length), length, "s") : undefined);
    const file = (await readdir(work)).find((f) => !f.endsWith(".part"));
    if (!file) throw new YtDlpError("El video es demasiado grande o no se pudo bajar.");
    const data = await readFile(path.join(work, file));
    if (data.byteLength === 0) throw new YtDlpError("No se pudo bajar el video (quedó vacío).");
    if (data.byteLength > MAX_BYTES) throw new YtDlpError("El video es demasiado grande (más de 2 GB).");
    const mime = path.extname(file).toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
    const out = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return { name: file, mime, data: out };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
