import { describe, expect, it } from "vitest";
import { saveFilters, withExtension } from "./saveName";

describe("withExtension", () => {
  it("adds the extension a retyped name lost", () => {
    expect(withExtension("C:\\Videos\\mi peli", "papa.mp4")).toBe("C:\\Videos\\mi peli.mp4");
    expect(withExtension("/Users/x/Movies/mi peli.", "papa.webm")).toBe("/Users/x/Movies/mi peli.webm");
  });
  it("leaves a name that has it (whatever its case), and one with dots in it gets it too", () => {
    expect(withExtension("/x/peli.MP4", "papa.mp4")).toBe("/x/peli.MP4");
    expect(withExtension("/x/peli v1.2", "papa.mp4")).toBe("/x/peli v1.2.mp4");
  });
  it("does nothing when the default name has no extension", () => {
    expect(withExtension("/x/algo", "sin")).toBe("/x/algo");
  });
});

describe("saveFilters", () => {
  it("offers the type of the default name", () => {
    expect(saveFilters("papa.mp4")).toEqual([{ name: "Video MP4", extensions: ["mp4"] }]);
    expect(saveFilters("hoja.svg")).toEqual([{ name: "Archivo SVG", extensions: ["svg"] }]);
    expect(saveFilters("sin")).toEqual([]);
  });
});
