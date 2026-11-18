import { describe, expect, it } from "vitest";
import { modeStuck, readTrackControls } from "./track";

const fakeTrack = (caps: Record<string, unknown>, settings: Record<string, unknown>) => ({ getCapabilities: () => caps, getSettings: () => settings }) as unknown as MediaStreamTrack;

const CAPS = {
  whiteBalanceMode: ["continuous", "manual"],
  exposureMode: ["continuous", "manual"],
  colorTemperature: { min: 2850, max: 7000, step: 50 },
  exposureTime: { min: 0.2, max: 2500, step: 0.1 },
  zoom: { min: 1, max: 8, step: 0.1 },
};

describe("readTrackControls", () => {
  it('reads Chrome on Android\'s "none" (a manual mode with a value set) as manual', () => {
    const controls = readTrackControls(fakeTrack(CAPS, { whiteBalanceMode: "continuous", exposureMode: "none", exposureTime: 635, colorTemperature: 4250, zoom: 1 }));
    const mode = controls.find((c) => c.key === "exposureMode");
    expect(mode).toMatchObject({ kind: "choice", value: "manual" });
  });

  it("marks as automatic the values whose mode is automatic", () => {
    const controls = readTrackControls(fakeTrack(CAPS, { whiteBalanceMode: "continuous", exposureMode: "none", exposureTime: 635, colorTemperature: 4250, zoom: 1 }));
    const auto = Object.fromEntries(controls.filter((c) => c.kind === "range").map((c) => [c.key, c.kind === "range" && c.auto]));
    expect(auto).toEqual({ colorTemperature: true, exposureTime: false, zoom: false });
  });
});

describe("modeStuck", () => {
  const control = { kind: "choice" as const, key: "whiteBalanceMode", label: "", options: [], value: "manual" };
  it("tells when a mode asked to be automatic stayed manual", () => {
    expect(modeStuck(fakeTrack(CAPS, { whiteBalanceMode: "manual" }), control, "continuous")).toBe(true);
    expect(modeStuck(fakeTrack(CAPS, { whiteBalanceMode: "continuous" }), control, "continuous")).toBe(false);
    expect(modeStuck(fakeTrack(CAPS, { whiteBalanceMode: "manual" }), control, "manual")).toBe(false);
  });
});
