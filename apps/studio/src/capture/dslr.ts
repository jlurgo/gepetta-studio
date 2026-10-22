import type { CameraControl, ControlValue } from "@gepetta/protocol";
import type { DslrErrorCode } from "../native";
import { type CameraSource, type CapturedStill, FrameSlot, Listeners, type SourceOption } from "./types";

/** DSLR/mirrorless cameras, driven by the desktop app (gphoto2 today, Canon SDK later). */

export const dslrAvailable = Boolean(window.gepetta);

/** gphoto2 reports Canon's international names; in the Americas the same bodies are sold as "Rebel". */
const CANON_REBEL: Record<string, string> = {
  "300D": "Digital Rebel",
  "350D": "Rebel XT",
  "400D": "Rebel XTi",
  "450D": "Rebel XSi",
  "1000D": "Rebel XS",
  "500D": "Rebel T1i",
  "550D": "Rebel T2i",
  "600D": "Rebel T3i",
  "1100D": "Rebel T3",
  "650D": "Rebel T4i",
  "700D": "Rebel T5i",
  "100D": "Rebel SL1",
  "1200D": "Rebel T5",
  "750D": "Rebel T6i",
  "760D": "Rebel T6s",
  "1300D": "Rebel T6",
  "200D": "Rebel SL2",
  "800D": "Rebel T7i",
  "2000D": "Rebel T7",
  "4000D": "Rebel T100",
  "250D": "Rebel SL3",
  "850D": "Rebel T8i",
};

export function dslrLabel(model: string): string {
  const m = /^Canon EOS (\w+)$/.exec(model.trim());
  const rebel = m && CANON_REBEL[m[1]!];
  return rebel ? `${model} / ${rebel}` : model;
}

export async function listDslrs(): Promise<SourceOption[]> {
  const native = window.gepetta;
  if (!native) return [];
  const status = await native.dslr.status();
  if (!status.available) return [];
  const cameras = await native.dslr.detect();
  return cameras.map((c) => ({ id: `dslr:${c.id}`, kind: "dslr" as const, label: dslrLabel(c.model) }));
}

export async function openDslr(
  port: string,
  onError: (message: string, code: DslrErrorCode) => void,
): Promise<CameraSource> {
  const native = window.gepetta!;
  const frames = new FrameSlot();
  const listeners = new Listeners();
  const offFrame = native.dslr.onFrame((id, jpeg) => id === port && frames.push(jpeg.slice(), () => listeners.emit()));
  const offError = native.dslr.onError((id, message, code) => id === port && onError(message, code));
  let controls: CameraControl[] = [];
  try {
    await native.dslr.open(port);
    controls = await native.dslr.getControls(port);
  } catch (e) {
    offFrame();
    offError();
    frames.close();
    throw e;
  }

  return {
    id: `dslr:${port}`,
    kind: "dslr",
    live: () => frames.get(),
    controls: () => controls,
    async setControl(control: CameraControl, value: ControlValue) {
      controls = await native.dslr.setControl(port, control.key, String(value));
      listeners.emit();
    },
    async capture(): Promise<CapturedStill> {
      const shot = await native.dslr.capture(port);
      return {
        image: new Blob([shot.jpeg.slice()], { type: "image/jpeg" }),
        raw: shot.raw ? { blob: new Blob([shot.raw.data.slice()], { type: shot.raw.mime }), name: shot.raw.name } : null,
      };
    },
    onChange: (cb) => listeners.add(cb),
    close() {
      offFrame();
      offError();
      frames.close();
      void native.dslr.close(port).catch(() => undefined);
    },
  };
}
