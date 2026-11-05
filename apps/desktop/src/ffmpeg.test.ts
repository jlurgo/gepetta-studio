import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
const { lastTime } = await import("./ffmpeg");

describe("lastTime", () => {
  it("reads the last progress time ffmpeg printed", () => {
    expect(lastTime("frame= 26 time=00:00:01.50 bitrate=N/A\rframe= 111 time=00:01:02.25 bitrate=N/A")).toBeCloseTo(62.25);
  });
  it("ignores negative times (before the stretch starts) and text without one", () => {
    expect(lastTime("frame= 0 time=-00:00:03.38 bitrate=-0.0kbits/s")).toBeNull();
    expect(lastTime("Press [q] to stop")).toBeNull();
  });
});
