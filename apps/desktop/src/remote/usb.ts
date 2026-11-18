import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { app } from "electron";

/**
 * Android phones over the USB cable, as cameras. The phone page is the same
 * one the QR opens; `adb reverse` makes the phone's own "localhost" reach this
 * computer through the cable, so no WiFi is needed and (localhost being a
 * secure address) the browser gives the camera without certificates. adb is
 * Google's tool for talking to a phone with "USB debugging" on: the one
 * installed is used, else it is fetched the first time and kept under the
 * app's data folder.
 */
export class UsbError extends Error {}

const BIN_NAME = process.platform === "win32" ? "adb.exe" : "adb";
const OS_NAME = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
const TOOLS_URL = `https://dl.google.com/android/repository/platform-tools-latest-${OS_NAME}.zip`;

const toolsDir = () => path.join(app.getPath("userData"), "tools");
const ownBin = () => path.join(toolsDir(), "platform-tools", BIN_NAME);

function run(bin: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }));
  });
}

/** Where an installed adb usually is. */
function installed(): string[] {
  const home = os.homedir();
  return process.platform === "win32"
    ? [path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk", "platform-tools", "adb.exe")]
    : ["/opt/homebrew/bin/adb", "/usr/local/bin/adb", path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"), path.join(home, "Android", "Sdk", "platform-tools", "adb")];
}

let fetching: Promise<void> | null = null;
/** The adb that linked phones, and the ports it linked, to take the links back. */
let linked: { adb: string; ports: number[] } | null = null;

async function fetchTools(): Promise<void> {
  await mkdir(toolsDir(), { recursive: true });
  const res = await fetch(TOOLS_URL, { redirect: "follow" });
  if (!res.ok || !res.body) throw new UsbError(`No se pudo bajar la herramienta para hablar con el celular (el servidor respondió ${res.status}).`);
  const zip = path.join(toolsDir(), "platform-tools.zip");
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>)
      .on("error", reject)
      .pipe(createWriteStream(zip))
      .on("finish", () => resolve())
      .on("error", reject);
  });
  // Windows 10 and later bring a tar that opens zips; Mac and Linux, unzip.
  const out = process.platform === "win32" ? await run("tar", ["-xf", zip, "-C", toolsDir()], 60_000) : await run("unzip", ["-o", "-q", zip, "-d", toolsDir()], 60_000);
  await rm(zip, { force: true });
  if (!out.ok || !existsSync(ownBin())) throw new UsbError("No se pudo preparar la herramienta para hablar con el celular.");
  if (process.platform !== "win32") await chmod(ownBin(), 0o755);
}

/** The adb to use: one on the PATH or in a usual place, else the app's own (downloaded the first time). */
async function ensureAdb(): Promise<string> {
  if ((await run(BIN_NAME, ["version"], 5000)).ok) return BIN_NAME;
  const found = [...installed(), ownBin()].find((p) => p && existsSync(p));
  if (found) return found;
  try {
    fetching ??= fetchTools().finally(() => (fetching = null));
    await fetching;
  } catch (e) {
    if (e instanceof UsbError) throw e;
    throw new UsbError("No se pudo bajar la herramienta para hablar con el celular: fijate que haya internet (hace falta solo la primera vez).");
  }
  return ownBin();
}

/** Phones `adb devices -l` lists: "<serial> <state> … model:<model> …". */
export function parseDevices(text: string): { serial: string; state: string; model: string }[] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().match(/^(\S+)\s+(device|unauthorized|offline|no permissions)\b(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ serial: m[1]!, state: m[2]!, model: (m[3]!.match(/model:(\S+)/)?.[1] ?? "celular").replace(/_+/g, " ").trim() }));
}

const HELP =
  "En el celular: Ajustes → Acerca del teléfono → tocá 7 veces «Número de compilación»; después, en Opciones para desarrolladores, prendé «Depuración por USB». Conectalo con un cable de datos.";

/**
 * Links every phone plugged in by USB to the app's phone server (`ports` of
 * this computer become the phone's localhost ones) and opens `url` in the
 * phone's browser. Returns the phones' names.
 */
export async function connectUsbPhones(ports: number[], url: string): Promise<string[]> {
  const adb = await ensureAdb();
  await run(adb, ["start-server"]);
  // adb takes a while to see a phone after it starts (some 10 s on a Mac): look for a moment.
  let phones: ReturnType<typeof parseDevices> = [];
  for (let tries = 0; tries < 15 && phones.length === 0; tries++) {
    if (tries) await new Promise((r) => setTimeout(r, 1000));
    const listed = await run(adb, ["devices", "-l"]);
    if (!listed.ok) throw new UsbError("No se pudo buscar el celular por USB.");
    phones = parseDevices(listed.stdout);
  }
  if (phones.length === 0) throw new UsbError(`No veo ningún celular por USB. ${HELP}`);
  const ready = phones.filter((p) => p.state === "device");
  if (ready.length === 0) {
    throw new UsbError(
      phones.some((p) => p.state === "unauthorized")
        ? "El celular pregunta si permitís la depuración por USB: mirá su pantalla, tocá «Permitir» y probá de nuevo."
        : "El celular está conectado pero no responde: desenchufalo, volvé a enchufarlo y probá de nuevo.",
    );
  }
  const names: string[] = [];
  linked = { adb, ports };
  for (const phone of ready) {
    const at = ["-s", phone.serial];
    for (const port of ports) {
      const done = await run(adb, [...at, "reverse", `tcp:${port}`, `tcp:${port}`]);
      if (!done.ok) throw new UsbError(`No se pudo enlazar el ${phone.model} por el cable. Desenchufalo, volvé a enchufarlo y probá de nuevo.`);
    }
    // The phone's shell reads this line: the address goes quoted (it has ? and #).
    const opened = await run(adb, [...at, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`]);
    if (!opened.ok) throw new UsbError(`No se pudo abrir la cámara en el ${phone.model}: desbloquealo y probá de nuevo.`);
    names.push(phone.model);
  }
  return names;
}

/** Takes the links back (when phones are no longer accepted). */
export async function releaseUsbPhones(): Promise<void> {
  if (!linked) return;
  const { adb, ports } = linked;
  linked = null;
  const listed = await run(adb, ["devices", "-l"], 5000);
  if (!listed.ok) return;
  for (const p of parseDevices(listed.stdout)) {
    if (p.state === "device") for (const port of ports) await run(adb, ["-s", p.serial, "reverse", "--remove", `tcp:${port}`], 5000);
  }
}
