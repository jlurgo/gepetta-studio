import { describe, expect, it } from "vitest";
import { cropRect, effectsFilter, isPlainLook, lookBox } from "./look";

const film = { width: 1920, height: 1080 };

describe("lookBox", () => {
  it("fits the whole picture inside the film by default", () => {
    expect(lookBox({ width: 1000, height: 1000 }, undefined, film)).toEqual({ width: 1080, height: 1080 });
  });
  it("fills the film with cover", () => {
    expect(lookBox({ width: 1000, height: 1000 }, { fit: "cover" }, film)).toEqual({ width: 1920, height: 1920 });
  });
  it("keeps the picture's size when cropped (the crop hides part of it in place)", () => {
    const box = lookBox({ width: 1920, height: 1080 }, { crop: { x: 0, y: 0, width: 0.5, height: 1 } }, film);
    expect(box).toEqual({ width: 1920, height: 1080 });
  });
});

describe("cropRect", () => {
  it("keeps the crop inside the picture", () => {
    const r = cropRect({ width: 100, height: 100 }, { crop: { x: 0.8, y: -1, width: 0.5, height: 2 } });
    expect(r.x).toBe(80);
    expect(r.y).toBe(0);
    expect(r.width).toBeCloseTo(20);
    expect(r.height).toBe(100);
  });
});

describe("effects", () => {
  it("builds a canvas filter, skipping effects at zero", () => {
    expect(effectsFilter([{ kind: "brightness", amount: 0.5 }, { kind: "contrast", amount: 0 }])).toBe("brightness(150%)");
    expect(effectsFilter(undefined)).toBe("none");
  });
  it("knows a look that changes nothing", () => {
    expect(isPlainLook({ fit: "contain", effects: [{ kind: "saturation", amount: 0 }] })).toBe(true);
    expect(isPlainLook({ flipX: true })).toBe(false);
  });
});
