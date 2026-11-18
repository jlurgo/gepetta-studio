import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
const { parseDevices } = await import("./usb");
const { RemoteServer } = await import("./server");

describe("parseDevices", () => {
  it("reads the phones adb lists, with their state and model", () => {
    const text = [
      "List of devices attached",
      "R58M12ABCDE            device usb:1-1 product:a52q model:SM_A525M device:a52q transport_id:3",
      "0123456789ABCDEF       unauthorized usb:1-2 transport_id:4",
      "",
    ].join("\n");
    expect(parseDevices(text)).toEqual([
      { serial: "R58M12ABCDE", state: "device", model: "SM A525M" },
      { serial: "0123456789ABCDEF", state: "unauthorized", model: "celular" },
    ]);
  });
  it("is empty when nothing is plugged in (also with Windows line ends)", () => {
    expect(parseDevices("List of devices attached\r\n\r\n")).toEqual([]);
  });
});

describe("the phone server for a phone on the cable", () => {
  it("gives a localhost address that opens the live camera page, with the token", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gepetta-usb-"));
    await writeFile(path.join(dir, "index.html"), "<p>celu</p>");
    const server = new RemoteServer({ certDir: path.join(dir, "certs"), phoneDir: dir, onEvent: () => {} });
    try {
      const { port, url } = await server.usbTarget();
      expect(url).toMatch(new RegExp(`^http://localhost:${port}/\\?t=[\\w-]+#vivo$`));
      const page = await fetch(url.replace("localhost", "127.0.0.1"));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("celu");
      const info = await fetch(`http://127.0.0.1:${port}/info.json?t=mal`);
      expect(info.status).toBe(403);
    } finally {
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
