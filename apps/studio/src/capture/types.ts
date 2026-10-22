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
