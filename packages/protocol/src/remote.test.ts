import { describe, expect, it } from "vitest";
import { type PhoneMessage, decodeMessage, encodeMessage } from "./remote";

describe("remote envelope", () => {
  it("round-trips header and payload", () => {
    const payload = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const bytes = encodeMessage({ t: "preview", w: 640, h: 480 }, payload);
    const { header, payload: out } = decodeMessage<PhoneMessage>(bytes);
    expect(header).toEqual({ t: "preview", w: 640, h: 480 });
    expect([...out!]).toEqual([...payload]);
  });

  it("handles header-only messages and offset views", () => {
    const bytes = encodeMessage({ t: "hello", protocol: 1, device: "Pixel ñ", mode: "live" });
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes, 3);
    const { header, payload } = decodeMessage<PhoneMessage>(padded.subarray(3));
    expect(header).toMatchObject({ device: "Pixel ñ" });
    expect(payload).toBeNull();
  });

  it("rejects truncated data", () => {
    expect(() => decodeMessage(new Uint8Array([10, 0, 0, 0, 1]))).toThrow();
  });
});
