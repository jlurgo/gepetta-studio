import type { CameraControl, ControlValue } from "@gepetta/protocol";

export type SourceKind = "webcam" | "phone" | "dslr";

/** A camera the user can pick. ids look like "webcam:<deviceId>", "phone:<session>", "dslr:<port>". */
export interface SourceOption {
  id: string;
  kind: SourceKind;
  label: string;
}

export interface LiveFrame {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface CapturedStill {
  image: Blob;
  /** The camera's RAW file, kept untouched next to the JPEG. */
  raw: { blob: Blob; name: string } | null;
}

/** An open camera: live view, settings and still capture, whatever the device. */
export interface CameraSource {
  readonly id: string;
  readonly kind: SourceKind;
  /** Latest live-view image, or null while it is not ready. */
  live(): LiveFrame | null;
  controls(): CameraControl[];
  setControl(control: CameraControl, value: ControlValue): Promise<void>;
  /** `average` > 1 averages that many frames to reduce noise (webcams only). */
  capture(average: number): Promise<CapturedStill>;
  /** Clockwise degrees the picture must turn to be upright, when the device knows (phones). */
  autoRotation?(): number | null;
  /** Called whenever controls or readiness change. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  close(): void;
}

/** Keeps the newest decoded JPEG frame, closing the previous one. Drops frames that arrive while decoding. */
export class FrameSlot {
  private bitmap: ImageBitmap | null = null;
  private decoding = false;
  private closed = false;

  push(jpeg: BlobPart, onFirst?: () => void) {
    if (this.decoding || this.closed) return;
    this.decoding = true;
    createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }))
      .then((bmp) => {
        if (this.closed) return bmp.close();
        const first = !this.bitmap;
        this.bitmap?.close();
        this.bitmap = bmp;
        if (first) onFirst?.();
      })
      .catch(() => undefined)
      .finally(() => (this.decoding = false));
  }

  get(): LiveFrame | null {
    const b = this.bitmap;
    return b ? { image: b, width: b.width, height: b.height } : null;
  }

  close() {
    this.closed = true;
    this.bitmap?.close();
    this.bitmap = null;
  }
}

export class Listeners {
  private set = new Set<() => void>();
  add(cb: () => void) {
    this.set.add(cb);
    return () => void this.set.delete(cb);
  }
  emit() {
    this.set.forEach((cb) => cb());
  }
}

/** Normalizes any angle to 0, 90, 180 or 270. */
export function quarterTurns(deg: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

let turnCanvas: HTMLCanvasElement | null = null;

/** The frame turned `deg` degrees clockwise (reuses one canvas; draw it before the next call). */
export function rotateFrame(frame: LiveFrame, deg: number): LiveFrame {
  const turn = quarterTurns(deg);
  if (turn === 0) return frame;
  const side = turn === 90 || turn === 270;
  const width = side ? frame.height : frame.width;
  const height = side ? frame.width : frame.height;
  turnCanvas ??= document.createElement("canvas");
  if (turnCanvas.width !== width || turnCanvas.height !== height) {
    turnCanvas.width = width;
    turnCanvas.height = height;
  }
  const ctx = turnCanvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(width / 2, height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(frame.image, -frame.width / 2, -frame.height / 2, frame.width, frame.height);
  return { image: turnCanvas, width, height };
}

/** A still turned `deg` degrees clockwise, re-encoded as JPEG (EXIF orientation applied first). */
export async function rotateBlob(blob: Blob, deg: number): Promise<Blob> {
  const turn = quarterTurns(deg);
  if (turn === 0) return blob;
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const side = turn === 90 || turn === 270;
    const canvas = new OffscreenCanvas(side ? bitmap.height : bitmap.width, side ? bitmap.width : bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  } finally {
    bitmap.close();
  }
}
