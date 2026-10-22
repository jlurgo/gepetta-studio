import { type ChildProcess, execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CameraControl } from "@gepetta/protocol";
import {
  READ_NAMES,
  SETTABLE_NAMES,
  ZOOM_STEPS,
  classifyGphotoError,
  parseAutoDetect,
  parseConfigList,
  rawMimeOf,
  toCameraControls,
} from "./gphoto2-parse";
import { extractEmbeddedJpeg } from "./jpeg";
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
 * DSLR driver on top of gphoto2 (macOS/Linux, any camera libgphoto2 supports).
 *
 * Each camera gets one long-lived `gphoto2 --shell` process. Live view is a loop
 * of `capture-preview` commands, and settings, focus and shots are queued in
 * between, so live view (and the mirror) stays up while the user changes things.
 * Starting and stopping live view per command used to flip the mirror each time.
 */

/** Electron GUI apps on macOS do not inherit the shell PATH. */
const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

const INSTALL_HINT = "Para usar cámaras réflex instalá gphoto2: abrí la Terminal y escribí  brew install gphoto2";
const WINDOWS_HINT =
  "En Windows todavía no se pueden usar cámaras réflex. Llegará para Canon con el kit oficial de Canon (EDSDK).";

const FRAME_INTERVAL_MS = 50; // ≤ 20 fps to the renderer
const AF_SETTLE_MS = 2500;
const PREVIEW_FILE = "capture_preview.jpg";
const PROMPT = /gphoto2: \{[^}]*\} \/> $/;
const TIMEOUT = { detect: 10_000, start: 10_000, command: 20_000, capture: 90_000, exit: 3_000 };

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

/**
 * One `gphoto2 --shell` process. Commands go in one line at a time; a command
 * is done when the prompt comes back. The process exits by itself when our
 * stdin closes, so a crashed app never leaves it holding the camera.
 */
export class Gphoto2Shell {
  private out = "";
  private pending: { resolve(out: string): void; reject(e: Error): void; timer: NodeJS.Timeout } | null = null;
  private exited = false;
  /** The camera answered at least once: later I/O errors mean "disconnected". */
  worked = false;
  onExit: ((err: DslrError) => void) | null = null;

  private constructor(
    private readonly proc: ChildProcess,
    readonly dir: string,
  ) {
    proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    proc.stderr!.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    proc.once("close", (code, signal) => {
      this.exited = true;
      const { code: kind, message } = classifyGphotoError(this.out, this.worked);
      const err =
        kind === "failed"
          ? new DslrError("Se cortó la conexión con la cámara.", "failed", `${this.out.slice(-2000)}\n(exit ${code ?? signal})`)
          : new DslrError(message, kind, this.out.slice(-2000));
      this.settle(null, err);
      this.onExit?.(err);
    });
  }

  static async start(binary: string, port: string): Promise<Gphoto2Shell> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gepetta-dslr-"));
    const proc = spawn(binary, ["--port", port, "--force-overwrite", "--shell"], {
      cwd: dir,
      env: childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const shell = new Gphoto2Shell(proc, dir);
    proc.once("error", () => undefined); // reported through "close"
    await shell.waitPrompt(TIMEOUT.start);
    return shell;
  }

  get alive() {
    return !this.exited;
  }

  private onData(text: string) {
    this.out = (this.out + text).slice(-256 * 1024);
    if (this.pending && PROMPT.test(this.out)) this.settle(this.out, null);
  }

  private settle(out: string | null, err: Error | null) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    if (err) p.reject(err);
    else p.resolve(out!);
  }

  private waitPrompt(timeout: number): Promise<string> {
    if (this.exited) return Promise.reject(new DslrError("La cámara no está conectada.", "disconnected"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new DslrError("La cámara tardó demasiado en responder.", "failed", this.out.slice(-2000)));
      }, timeout);
      this.pending = { resolve, reject, timer };
      if (PROMPT.test(this.out)) this.settle(this.out, null);
    });
  }

  /** Runs one shell command and returns its output (without the echo and prompt). */
  async exec(line: string, timeout = TIMEOUT.command): Promise<string> {
    if (line.includes("\n") || line.includes("\r")) throw new DslrError("Ajuste inválido.", "failed");
    this.out = "";
    const done = this.waitPrompt(timeout);
    this.proc.stdin!.write(`${line}\n`);
    const raw = (await done).replace(PROMPT, "");
    const text = raw.startsWith(line) ? raw.slice(line.length).replace(/^\r?\n/, "") : raw;
    if (/\*\*\* Error/.test(text)) {
      const { code, message } = classifyGphotoError(text, this.worked);
      throw new DslrError(code === "failed" ? "La cámara no aceptó el cambio." : message, code, text);
    }
    this.worked = true;
    return text;
  }

  /** Leaves live view (mirror down) and ends the process. */
  async close() {
    if (!this.exited) {
      await this.exec("set-config viewfinder=0", TIMEOUT.exit).catch(() => undefined);
      this.proc.stdin!.end("exit\n");
      const timer = setTimeout(() => this.proc.kill("SIGKILL"), TIMEOUT.exit);
      await new Promise((r) => (this.exited ? r(null) : this.proc.once("close", r)));
      clearTimeout(timer);
    }
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface CameraSession {
  id: string;
  shell: Gphoto2Shell | null;
  /** Tail of the promise chain that serializes commands. */
  queue: Promise<unknown>;
  /** The UI wants live view (cleared by close()). */
  wantLive: boolean;
  loopRunning: boolean;
  onFrame: FrameListener | null;
  onError: ErrorListener | null;
  /** Config paths by leaf name, from the last listing. */
  paths: Map<string, string>;
  /** Canon reports eoszoom as 0 whatever it is set to, so we remember what we set. */
  zoom: string;
  /**
   * open() calls not yet matched by close(). Overlapping open/close pairs (React
   * mounts effects twice in development) must not tear down a session in use.
   */
  leases: number;
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
      s = { id, shell: null, queue: Promise.resolve(), wantLive: false, loopRunning: false, onFrame: null, onError: null, paths: new Map(), zoom: "1", leases: 0 };
      sessions.set(id, s);
    }
    return s;
  }

  /** Runs gphoto2 once to completion (used for detection, which needs no session). */
  async function runOnce(args: string[], timeout: number): Promise<string> {
    const file = await bin();
    return new Promise((resolve, reject) => {
      execFile(file, args, { env: childEnv(), timeout, encoding: "utf8" }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const { code, message } = classifyGphotoError(`${stderr}\n${stdout}`);
        reject(new DslrError(message, code, stderr));
      });
    });
  }

  /** Appends `fn` to the camera's command queue, with a running shell. */
  function enqueue<T>(s: CameraSession, fn: (shell: Gphoto2Shell) => Promise<T>): Promise<T> {
    const task = s.queue.then(async () => {
      if (!s.shell?.alive) {
        const shell = await Gphoto2Shell.start(await bin(), s.id);
        shell.onExit = (err) => {
          if (s.shell !== shell) return;
          s.shell = null;
          if (s.wantLive) s.onError?.(err.message, err.code);
        };
        s.shell = shell;
      }
      return fn(s.shell);
    });
    s.queue = task.catch(() => undefined);
    return task;
  }

  /** One live-view frame. */
  async function preview(s: CameraSession) {
    await enqueue(s, async (shell) => {
      await shell.exec("capture-preview");
      const jpeg = await readFile(path.join(shell.dir, PREVIEW_FILE));
      s.onFrame?.(jpeg);
    });
  }

  /** Keeps live view going while wanted; other commands slip in between frames. */
  async function liveLoop(s: CameraSession) {
    if (s.loopRunning) return;
    s.loopRunning = true;
    try {
      while (s.wantLive) {
        const started = Date.now();
        try {
          await preview(s);
        } catch (err) {
          if (!s.wantLive) break;
          const e = err instanceof DslrError ? err : new DslrError("Se cortó la vista en vivo de la cámara.", "failed");
          s.onError?.(e.message, e.code);
          if (e.code !== "failed") break; // busy / disconnected: wait for the user to retry
          await new Promise((r) => setTimeout(r, 1000));
        }
        const wait = FRAME_INTERVAL_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      s.loopRunning = false;
    }
  }

  /** Drops one open() lease; the last one stops live view and ends the shell. */
  async function release(s: CameraSession) {
    s.leases = Math.max(0, s.leases - 1);
    if (s.leases > 0) return;
    s.wantLive = false;
    s.onFrame = null;
    s.onError = null;
    await s.queue;
    if (s.leases > 0) return; // reopened while we waited
    const shell = s.shell;
    s.shell = null;
    s.paths.clear();
    s.zoom = "1";
    await shell?.close();
  }

  async function listControls(s: CameraSession): Promise<CameraControl[]> {
    return enqueue(s, async (shell) => {
      if (s.paths.size === 0) {
        for (const p of (await shell.exec("list-config")).split(/\r?\n/)) {
          const pathLine = p.trim();
          if (!pathLine.startsWith("/")) continue;
          const name = pathLine.slice(pathLine.lastIndexOf("/") + 1);
          if (READ_NAMES.has(name) && !s.paths.has(name)) s.paths.set(name, pathLine);
        }
      }
      // Same text shape as --list-all-config, so one parser serves both.
      let text = "";
      for (const p of s.paths.values()) text += `${p}\n${await shell.exec(`get-config ${p}`)}\n`;
      return toCameraControls(parseConfigList(text)).map((c) =>
        c.key === "eoszoom" && c.kind === "choice" ? { ...c, value: s.zoom } : c,
      );
    });
  }

  return {
    async status(): Promise<DslrStatus> {
      if (process.platform === "win32") return { available: false, reason: "unsupported-os", hint: WINDOWS_HINT };
      binary = await findGphoto2();
      if (!binary) return { available: false, reason: "not-installed", hint: INSTALL_HINT };
      return { available: true };
    },

    async detect(): Promise<DslrCamera[]> {
      return parseAutoDetect(await runOnce(["--auto-detect"], TIMEOUT.detect));
    },

    async open(id, onFrame, onError) {
      assertPort(id);
      const s = session(id);
      s.leases++;
      s.onFrame = onFrame;
      s.onError = onError;
      s.wantLive = true;
      try {
        await bin();
        await preview(s); // first frame, so errors reach the caller
      } catch (err) {
        await release(s);
        throw err;
      }
      void liveLoop(s);
    },

    async close(id) {
      assertPort(id);
      const s = sessions.get(id);
      if (s) await release(s);
    },

    async capture(id) {
      assertPort(id);
      const s = session(id);
      return enqueue(s, async (shell): Promise<DslrCapture> => {
        await shell.exec("capture-image-and-download", TIMEOUT.capture);
        s.zoom = "1"; // the camera leaves magnification after a shot
        // The shell saves under the camera's file names: move them aside to read them.
        const dir = path.join(shell.dir, `shot-${Date.now()}`);
        await mkdir(dir);
        try {
          for (const name of await readdir(shell.dir)) {
            if (name === PREVIEW_FILE || name.startsWith("shot-")) continue;
            await rename(path.join(shell.dir, name), path.join(dir, name));
          }
          return await collectCapture(dir);
        } finally {
          await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    },

    async getControls(id) {
      assertPort(id);
      return listControls(session(id));
    },

    async setControl(id, key, value) {
      assertPort(id);
      if (typeof key !== "string" || typeof value !== "string" || value.length > 200 || /[\0\r\n]/.test(value)) {
        throw new DslrError("Ajuste inválido.", "failed");
      }
      const s = session(id);
      let commands: string[];
      if (key === "manualfocusdrive") {
        if (!/^(Near|Far) [1-3]$/.test(value)) throw new DslrError("Ajuste inválido.", "failed");
        // Canon only drives the lens in live view, and only with the lens switch on AF.
        commands = [...(s.wantLive ? [] : ["set-config viewfinder=1"]), `set-config manualfocusdrive=${value}`];
      } else if (key === "autofocusdrive") {
        // Releasing the AF trigger right away cancels the focus run, so it is released later (below).
        commands = ["set-config autofocusdrive=1"];
      } else if (key === "eoszoom") {
        if (!ZOOM_STEPS.some((z) => z.value === value)) throw new DslrError("Ajuste inválido.", "failed");
        commands = [`set-config eoszoom=${value}`];
        s.zoom = value;
      } else if (SETTABLE_NAMES.has(key)) {
        commands = [`set-config-value ${key}=${value}`];
      } else {
        throw new DslrError("Ese ajuste no se puede cambiar desde Gepetta.", "failed");
      }
      await enqueue(s, async (shell) => {
        try {
          for (const c of commands) await shell.exec(c);
          if (key === "autofocusdrive") {
            // Give the lens time to hunt while live view keeps refreshing, then release the trigger.
            setTimeout(() => void enqueue(s, (sh) => sh.exec("set-config autofocusdrive=0")).catch(() => undefined), AF_SETTLE_MS);
          }
        } catch (err) {
          if (key === "manualfocusdrive" || key === "autofocusdrive") {
            throw new DslrError("El lente no se movió. Poné la palanca del lente en AF para enfocar desde la app.", "failed");
          }
          throw err;
        }
      });
      return listControls(s);
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
        s.leases = 0;
        s.wantLive = false;
        s.onFrame = null;
        s.onError = null;
      }
      await Promise.all(all.map((s) => s.shell?.close()));
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
