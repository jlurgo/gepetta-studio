import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { app } from "electron";

/**
 * ffmpeg, to download just a stretch of a long video (from a link, or from
 * YouTube through yt-dlp) instead of all of it. Like yt-dlp it is fetched the
 * first time it is needed (a self-contained build from the ffmpeg-static
 * project, github.com/eugeneware/ffmpeg-static) and kept under the app's data
 * folder.
 */
export class FfmpegError extends Error {}

const TAG = "b6.1.1";
const BIN_NAME = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const RELEASE_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${TAG}/ffmpeg-${process.platform}-${process.arch}.gz`;

const binPath = () => path.join(app.getPath("userData"), "tools", BIN_NAME);

let fetching: Promise<void> | null = null;

async function fetchBinary(): Promise<void> {
  await mkdir(path.dirname(binPath()), { recursive: true });
  const res = await fetch(RELEASE_URL, { redirect: "follow" });
  if (!res.ok || !res.body) throw new FfmpegError(`No se pudo bajar la herramienta para cortar videos (el servidor respondió ${res.status}).`);
  const tmp = `${binPath()}.part`;
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>)
      .on("error", reject)
      .pipe(createGunzip())
      .on("error", reject)
      .pipe(createWriteStream(tmp))
      .on("finish", () => resolve())
      .on("error", reject);
  });
  if (process.platform !== "win32") await chmod(tmp, 0o755);
  await rename(tmp, binPath());
}

/** Makes sure ffmpeg is there (downloading it the first time), and returns its path. */
export async function ensureFfmpeg(status?: (msg: string) => void): Promise<string> {
  if (!existsSync(binPath())) {
    status?.("Preparando por primera vez (bajando una herramienta para cortar videos, puede tardar un minuto)…");
    fetching ??= fetchBinary().finally(() => (fetching = null));
    await fetching;
  }
  return binPath();
}

/** Seconds of a "time=HH:MM:SS.ss" (ffmpeg's progress), when there is one and it is not negative. */
export function lastTime(text: string): number | null {
  const all = [...text.matchAll(/time=(-?)(\d+):(\d+):([\d.]+)/g)];
  const m = all.at(-1);
  if (!m || m[1]) return null;
  return Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/**
 * Copies the stretch from `from` to `to` (seconds) of a video (a link or a
 * file) into `out`, without re-encoding (so it starts at the key frame just
 * before `from`), reporting the seconds done.
 */
export async function cutVideo(input: string, from: number, to: number, out: string, onSeconds: (done: number) => void, status?: (msg: string) => void): Promise<void> {
  const bin = await ensureFfmpeg(status);
  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-user_agent",
    "Mozilla/5.0 (Gepetta Studio)",
    "-ss",
    String(from),
    "-to",
    String(to),
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    ...(out.endsWith(".mp4") ? ["-movflags", "+faststart"] : []),
    "-progress",
    "pipe:1",
    out,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const m = [...chunk.toString().matchAll(/out_time_us=(\d+)/g)].at(-1);
      if (m) onSeconds(Number(m[1]) / 1e6);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("error", () => reject(new FfmpegError("No se pudo ejecutar la herramienta para cortar videos.")));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      console.error("[gepetta] ffmpeg failed", code, stderr.slice(-2000));
      const e = stderr.toLowerCase();
      reject(
        new FfmpegError(
          /403|401|forbidden|unauthorized/.test(e)
            ? "Ese link no deja bajar un tramo (pide permiso). Probá bajarlo entero."
            : /404|not found/.test(e)
              ? "No se encontró el video en ese link."
              : /invalid data|moov atom|could not find codec|unknown format/.test(e)
                ? "No se pudo leer ese tramo del video (¿el link lleva a una página y no al archivo?). Probá bajarlo entero."
                : "No se pudo bajar ese tramo. Fijate que haya internet, o probá bajarlo entero.",
        ),
      );
    });
  });
}
