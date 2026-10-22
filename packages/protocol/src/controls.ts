/** A camera setting as shown in the UI, whatever the device (webcam, phone, DSLR). */
export type CameraControl =
  | {
      kind: "range";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      value: number;
      /** Mode that must be "manual" for this value to stick (e.g. focusDistance → focusMode). */
      manualMode?: string;
    }
  | { kind: "choice"; key: string; label: string; options: ControlOption[]; value: string }
  | { kind: "toggle"; key: string; label: string; value: boolean }
  /** Momentary commands, e.g. "focus nearer" on a DSLR. */
  | { kind: "action"; key: string; label: string; actions: ControlOption[] };

export interface ControlOption {
  value: string;
  label: string;
}

export type ControlValue = number | string | boolean;
