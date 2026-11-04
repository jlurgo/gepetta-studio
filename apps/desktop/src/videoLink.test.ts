import { type Server, createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
const { downloadVideo } = await import("./videoLink");
const { videoId } = await import("./youtubeLink");

const VIDEO = new Uint8Array(600 * 1024).map((_, i) => i % 251);
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/clip.mp4") {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": VIDEO.length });
      res.end(VIDEO);
    } else if (req.url === "/download?id=7") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="gato saltando.webm"' });
      res.end(VIDEO.subarray(0, 1000));
    } else if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => server.close());

describe("video from a link", () => {
  it("downloads a video file, telling how far it got", async () => {
    const seen: number[] = [];
    const got = await downloadVideo(`${base}/clip.mp4`, (r) => seen.push(r));
    expect(got.name).toBe("clip.mp4");
    expect(got.mime).toBe("video/mp4");
    expect(new Uint8Array(got.data)).toEqual(VIDEO);
    expect(seen.at(-1)).toBe(VIDEO.length);
  });

  it("takes the file's name from the server", async () => {
    const got = await downloadVideo(`${base}/download?id=7`, () => undefined);
    expect([got.name, got.mime, got.data.byteLength]).toEqual(["gato saltando.webm", "video/mp4", 1000]);
  });

  it("says what is wrong with a link that is not a video", async () => {
    await expect(downloadVideo(`${base}/page`, () => undefined)).rejects.toThrow("página");
    await expect(downloadVideo(`${base}/nada.mp4`, () => undefined)).rejects.toThrow("404");
    await expect(downloadVideo("hola", () => undefined)).rejects.toThrow("no es un link");
    await expect(downloadVideo("https://youtu.be/aqz-KE-bpKQ", () => undefined)).rejects.toThrow("YouTube");
  });

  it("finds a YouTube video's id in its links", () => {
    expect(["https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3", "https://youtu.be/aqz-KE-bpKQ", "https://youtube.com/shorts/aqz-KE-bpKQ", "aqz-KE-bpKQ", "https://vimeo.com/1"].map(videoId)).toEqual([
      "aqz-KE-bpKQ",
      "aqz-KE-bpKQ",
      "aqz-KE-bpKQ",
      "aqz-KE-bpKQ",
      null,
    ]);
  });
});
