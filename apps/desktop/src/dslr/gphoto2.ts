import { type ChildProcess, execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CameraControl } from "@gepetta/protocol";
import {
  SETTABLE_NAMES,
  classifyGphotoError,
  parseAutoDetect,
  parseConfigList,
  rawMimeOf,
  toCameraControls,
} from "./gphoto2-parse";
import { MjpegSplitter, extractEmbeddedJpeg } from "./jpeg";
import {
  type DslrCamera,
  type DslrCapture,
  type DslrDriver,
  DslrError,
  type DslrStatus,
  type ErrorListener,
  type FrameListener,
} from "./types";

/**
 * DSLR driver on top of the gphoto2 CLI (macOS/Linux, any camera libgphoto2
 * supports). A camera does one thing at a time over USB, so every command for
 * a camera runs through `exclusive()`, which pauses live view around it.
 */

/** Electron GUI apps on macOS do not inherit the shell PATH. */
const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

const INSTALL_HINT = "Para usar cámaras réflex instalá gphoto2: abrí la Terminal y escribí  brew install gphoto2";
const WINDOWS_HINT =
  "En Windows todavía no se pueden usar cámaras réflex. Llegará para Canon con el kit oficial de Canon (EDSDK).";

const FRAME_INTERVAL_MS = 50; // ≤ 20 fps to the renderer
const LIVE_MAX_FRAME_BYTES = 4 * 1024 * 1024;
const STOP_GRACE_MS = 3000;
const OPEN_WAIT_MS = 10000;

const TIMEOUT = { detect: 10_000, config: 20_000, set: 20_000, capture: 90_000 };

const SAFE_PORT = /^[a-z]+:[^\s\0]*$/i;

function searchDirs(): string[] {
  const fromEnv = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return [...new Set([...fromEnv, ...EXTRA_DIRS])];
}

/** gphoto2 binary path, or null when it is not installed. */
export async function findGphoto2(): Promise<string | null> {
  for (const dir of searchDirs()) {
    const candidate = path.join(dir, "gphoto2");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** English messages (for error classification) and a PATH that finds gphoto2's helpers. */
function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LANG: "C", LC_ALL: "C", PATH: searchDirs().join(path.delimiter) };
}

function assertPort(id: unknown): asserts id is string {
  if (typeof id !== "string" || !SAFE_PORT.test(id)) throw new DslrError("Cámara desconocida.", "failed");
}

interface LiveView {
  proc: ChildProcess;
  stopping: boolean;
  exited: Promise<void>;
}

interface CameraSession {
  id: string;
  /** Tail of the promise chain that serializes commands. */
  queue: Promise<unknown>;
  live: LiveView | null;
  /** The UI wants live view (cleared by close()). */
  wantLive: boolean;
  onFrame: FrameListener | null;
  onError: ErrorListener | null;
  /** The camera answered at least once: later I/O errors mean "disconnected". */
  worked: boolean;
  /** Leaf names from the last config listing. */
  configNames: Set<string>;
}

export function createGphoto2Driver(): DslrDriver {
  const sessions = new Map<string, CameraSession>();
  let binary: string | null = null;

  async function bin(): Promise<string> {
    if (process.platform === "win32") throw new DslrError(WINDOWS_HINT, "failed");
    // Re-check while missing: the user may install it with the app open.
    binary ??= await findGphoto2();
    if (!binary) throw new DslrError(INSTALL_HINT, "failed");
    return binary;
  }

  function session(id: string): CameraSession {
    let s = sessions.get(id);
    if (!s) {
      s = {
        id,
        queue: Promise.resolve(),
        live: null,
        wantLive: false,
        onFrame: null,
        onError: null,
        worked: false,
        configNames: new Set(),
      };
      sessions.set(id, s);
    }
    return s;
  }

  /** Runs gphoto2 to completion; rejects with a classified DslrError. */
  async function run(args: string[], timeout: number, s?: CameraSession): Promise<string> {
    const file = await bin();
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        { env: childEnv(), timeout, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
        (err, stdout, stderr) => {
          if (!err) {
            if (s) s.worked = true;
            resolve(stdout);
            return;
          }
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.code === "ENOENT") {
            binary = null;
            reject(new DslrError(INSTALL_HINT, "failed"));
            return;
          }
          if (e.killed) {
            reject(new DslrError("La cámara tardó demasiado en responder.", "failed", stderr));
            return;
          }
          const { code, message } = classifyGphotoError(`${stderr}\n${stdout}`, s?.worked ?? false);
          reject(new DslrError(message, code, stderr));
        },
      );
    });
  }

  /** Appends `fn` to the camera's command queue. */
  function enqueue<T>(s: CameraSession, fn: () => Promise<T>): Promise<T> {
    const task = s.queue.then(fn);
    s.queue = task.catch(() => undefined);
    return task;
  }

  /**
   * Runs `fn` alone on the camera: stops live view if it is on and restarts it
   * afterwards (queued, so the next command waits for the restart).
   */
  function exclusive<T>(s: CameraSession, fn: () => Promise<T>): Promise<T> {
    let wasLive = false;
    const task = enqueue(s, async () => {
      wasLive = s.live !== null;
      if (wasLive) await stopLive(s);
      return fn();
    });
    void enqueue(s, async () => {
      if (!wasLive || !s.wantLive || s.live) return;
      try {
        await spawnLive(s).ready;
      } catch (err) {
        reportError(s, err);
      }
    });
    return task;
  }

  function reportError(s: CameraSession, err: unknown) {
    const e = err instanceof DslrError ? err : new DslrError("La cámara dejó de responder.", "failed");
    s.onError?.(e.message, e.code);
  }

  /**
   * Starts `--capture-movie` (without a count it runs until interrupted).
   * `ready` resolves on the first frame (or after a while, for slow cameras) and
   * rejects if gphoto2 dies before; later deaths go to onError.
   */
  function spawnLive(s: CameraSession): { ready: Promise<void> } {
    if (!binary) throw new DslrError(INSTALL_HINT, "failed");
    const proc = spawn(binary, ["--port", s.id, "--stdout", "--capture-movie"], {
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const live: LiveView = {
      proc,
      stopping: false,
      exited: new Promise((resolve) => proc.once("close", () => resolve())),
    };
    s.live = live;

    let settle: ((err?: DslrError) => void) | null = null;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => settle?.(), OPEN_WAIT_MS);
      settle = (err) => {
        clearTimeout(timer);
        settle = null;
        if (err) reject(err);
        else resolve();
      };
    });

    const splitter = new MjpegSplitter(LIVE_MAX_FRAME_BYTES);
    let stderr = "";
    let lastFrameAt = 0;
    proc.stdout!.on("data", (chunk: Buffer) => {
      for (const frame of splitter.push(chunk)) {
        s.worked = true;
        settle?.();
        const now = Date.now();
        if (now - lastFrameAt < FRAME_INTERVAL_MS) continue; // drop extras
        lastFrameAt = now;
        s.onFrame?.(frame);
      }
    });
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-8192);
    });
    proc.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") binary = null;
      stderr += `\n${err.message}`;
    });
    proc.once("close", (code, signal) => {
      if (s.live === live) s.live = null;
      if (live.stopping) {
        settle?.();
        return;
      }
      const classified = classifyGphotoError(stderr, s.worked);
      const err =
        classified.code === "failed"
          ? new DslrError("Se cortó la vista en vivo de la cámara.", "failed", `${stderr}\n(exit ${code ?? signal})`)
          : new DslrError(classified.message, classified.code, stderr);
      if (settle) settle(err);
      else s.onError?.(err.message, err.code);
    });
    return { ready };
  }

  /** Stops live view cleanly: SIGINT lets gphoto2 take the camera out of movie mode. */
  async function stopLive(s: CameraSession): Promise<void> {
    const live = s.live;
    if (!live) return;
    live.stopping = true;
    const { proc } = live;
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGINT");
      const escalate = setTimeout(() => proc.kill("SIGTERM"), STOP_GRACE_MS);
      const last = setTimeout(() => proc.kill("SIGKILL"), STOP_GRACE_MS * 2);
      await live.exited;
      clearTimeout(escalate);
      clearTimeout(last);
    }
    if (s.live === live) s.live = null;
  }

  async function listConfig(s: CameraSession, id: string): Promise<CameraControl[]> {
    const entries = parseConfigList(await run(["--port", id, "--list-all-config"], TIMEOUT.config, s));
    s.configNames = new Set(entries.map((e) => e.name));
    return toCameraControls(entries);
  }

  return {
    async status(): Promise<DslrStatus> {
      if (process.platform === "win32") return { available: false, reason: "unsupported-os", hint: WINDOWS_HINT };
      binary = await findGphoto2();
      if (!binary) return { available: false, reason: "not-installed", hint: INSTALL_HINT };
      return { available: true };
    },

    async detect(): Promise<DslrCamera[]> {
      return parseAutoDetect(await run(["--auto-detect"], TIMEOUT.detect));
    },

    async open(id, onFrame, onError) {
      assertPort(id);
      const s = session(id);
      s.onFrame = onFrame;
      s.onError = onError;
      s.wantLive = true;
      await bin();
      // Wrapped so the queue only waits for the spawn, not for the first frame.
      const started = await enqueue(s, async () => (s.wantLive && !s.live ? spawnLive(s) : null));
      await started?.ready;
    },

    async close(id) {
      assertPort(id);
      const s = sessions.get(id);
      if (!s) return;
      s.wantLive = false;
      await enqueue(s, () => stopLive(s));
    },

    async capture(id) {
      assertPort(id);
      const s = session(id);
      return exclusive(s, async (): Promise<DslrCapture> => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "gepetta-dslr-"));
        try {
          await run(
            [
              "--port",
              id,
              "--capture-image-and-download",
              "--filename",
              path.join(dir, "%f.%C"),
              "--force-overwrite",
            ],
            TIMEOUT.capture,
            s,
          );
          return await collectCapture(dir);
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    },

    async getControls(id) {
      assertPort(id);
      const s = session(id);
      return exclusive(s, () => listConfig(s, id));
    },

    async setControl(id, key, value) {
      assertPort(id);
      if (typeof key !== "string" || typeof value !== "string" || value.includes("\0") || value.length > 200) {
        throw new DslrError("Ajuste inválido.", "failed");
      }
      const s = session(id);
      let args: string[];
      if (key === "manualfocusdrive") {
        if (!/^(Near|Far) [1-3]$/.test(value)) throw new DslrError("Ajuste inválido.", "failed");
        // Canon only drives the lens in live view: turn it on in the same session.
        args = s.configNames.has("viewfinder") || s.configNames.size === 0 ? ["--set-config", "viewfinder=1"] : [];
        args.push("--set-config", `manualfocusdrive=${value}`);
      } else if (key === "autofocusdrive") {
        args = ["--set-config", "autofocusdrive=1"];
      } else if (SETTABLE_NAMES.has(key)) {
        args = ["--set-config-value", `${key}=${value}`];
      } else {
        throw new DslrError("Ese ajuste no se puede cambiar desde Gepetta.", "failed");
      }
      return exclusive(s, async () => {
        await run(["--port", id, ...args], TIMEOUT.set, s);
        return listConfig(s, id);
      });
    },

    async releaseUsb() {
      if (process.platform !== "darwin") return;
      // ptpcamerad ignores SIGTERM (checked on macOS 14), so it takes SIGKILL.
      for (const name of ["PTPCamera", "ptpcamerad"]) {
        await new Promise<void>((resolve, reject) => {
          execFile("/usr/bin/killall", ["-KILL", name], { encoding: "utf8" }, (err, _stdout, stderr) => {
            if (!err || /No matching processes/i.test(stderr)) resolve();
            else reject(new DslrError("No pude liberar la cámara. Desenchufala y volvé a enchufarla.", "failed", stderr));
          });
        });
      }
    },

    async dispose() {
      const all = [...sessions.values()];
      for (const s of all) {
        s.wantLive = false;
        s.onFrame = null;
        s.onError = null;
      }
      await Promise.all(all.map((s) => stopLive(s)));
      sessions.clear();
    },
  };
}

/** Reads what --capture-image-and-download left in `dir`: a JPEG and/or a RAW. */
export async function collectCapture(dir: string): Promise<DslrCapture> {
  let jpeg: Buffer | null = null;
  let raw: DslrCapture["raw"] = null;
  for (const name of await readdir(dir)) {
    const ext = path.extname(name).slice(1).toLowerCase();
    if (ext === "jpg" || ext === "jpeg") {
      jpeg = await readFile(path.join(dir, name));
      continue;
    }
    const mime = rawMimeOf(ext);
    if (mime) raw = { data: await readFile(path.join(dir, name)), mime, name };
  }
  if (!jpeg && raw) jpeg = extractEmbeddedJpeg(raw.data);
  if (!jpeg) {
    throw new DslrError(
      raw
        ? "La foto se sacó en RAW pero no pude leer su vista previa. Elegí «RAW+JPEG» en Formato de imagen."
        : "La cámara no devolvió ninguna foto. Revisá que tenga tarjeta o probá de nuevo.",
      "failed",
    );
  }
  return { jpeg, raw };
}
