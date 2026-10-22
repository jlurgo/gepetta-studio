import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Each film is a folder `<name>-<id8>.gepetta/` holding `film.json` (the full
 * history), `meta.json` (what the library needs) and `assets/<sha256>.<ext>`.
 */

export interface FilmMeta {
  id: string;
  name: string;
  updatedAt: number;
  frameCount: number;
  thumb: string | null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tif",
  "image/svg+xml": "svg",
  "image/x-canon-cr2": "cr2",
  "image/x-canon-cr3": "cr3",
  "image/x-nikon-nef": "nef",
  "image/x-sony-arw": "arw",
  "image/x-adobe-dng": "dng",
  "image/x-fuji-raf": "raf",
  "image/x-olympus-orf": "orf",
  "image/x-panasonic-rw2": "rw2",
  "image/x-raw": "raw",
};

const SAFE_ID = /^[A-Za-z0-9-]+$/;

function assertId(id: string) {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid id: ${id}`);
}

function slug(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9 _-]/g, "")
      .trim()
      .slice(0, 40) || "pelicula"
  );
}

export class FilmLibrary {
  private dirs = new Map<string, string>();

  constructor(readonly root: string) {}

  private async scan() {
    await mkdir(this.root, { recursive: true });
    this.dirs.clear();
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".gepetta")) continue;
      const dir = path.join(this.root, entry.name);
      try {
        const meta: FilmMeta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8"));
        this.dirs.set(meta.id, dir);
      } catch {
        // Not a film folder (or a half-written one): skip it.
      }
    }
  }

  async dirOf(id: string, create?: { name: string }): Promise<string> {
    assertId(id);
    if (!this.dirs.has(id)) await this.scan();
    let dir = this.dirs.get(id);
    if (!dir) {
      if (!create) throw new Error(`Película no encontrada: ${id}`);
      dir = path.join(this.root, `${slug(create.name)}-${id.slice(0, 8)}.gepetta`);
      await mkdir(path.join(dir, "assets"), { recursive: true });
      this.dirs.set(id, dir);
    }
    return dir;
  }

  async list(): Promise<FilmMeta[]> {
    await this.scan();
    const metas = await Promise.all(
      [...this.dirs.values()].map(async (dir) => JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as FilmMeta),
    );
    return metas;
  }

  async load(id: string): Promise<string> {
    return readFile(path.join(await this.dirOf(id), "film.json"), "utf8");
  }

  async save(id: string, meta: FilmMeta, json: string) {
    const dir = await this.dirOf(id, { name: meta.name });
    // Write-then-rename so a crash never leaves a truncated film.json.
    const tmp = path.join(dir, "film.json.tmp");
    await writeFile(tmp, json);
    await rename(tmp, path.join(dir, "film.json"));
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  async remove(id: string) {
    const dir = await this.dirOf(id);
    await rm(dir, { recursive: true, force: true });
    this.dirs.delete(id);
  }

  private async findAsset(filmId: string, assetId: string): Promise<string | null> {
    if (!/^[0-9a-f]{64}$/.test(assetId)) throw new Error(`Invalid asset id: ${assetId}`);
    const assets = path.join(await this.dirOf(filmId), "assets");
    for (const ext of new Set([...Object.values(EXT_BY_MIME), "bin"])) {
      const p = path.join(assets, `${assetId}.${ext}`);
      if (existsSync(p)) return p;
    }
    return null;
  }

  async hasAsset(filmId: string, assetId: string) {
    return (await this.findAsset(filmId, assetId)) !== null;
  }

  async putAsset(filmId: string, assetId: string, mime: string, data: ArrayBuffer) {
    if (await this.hasAsset(filmId, assetId)) return;
    const ext = EXT_BY_MIME[mime] ?? "bin";
    const assets = path.join(await this.dirOf(filmId), "assets");
    await mkdir(assets, { recursive: true });
    await writeFile(path.join(assets, `${assetId}.${ext}`), Buffer.from(data));
  }

  async getAsset(filmId: string, assetId: string): Promise<Buffer> {
    const p = await this.findAsset(filmId, assetId);
    if (!p) throw new Error(`Falta el archivo ${assetId}`);
    return readFile(p);
  }
}
