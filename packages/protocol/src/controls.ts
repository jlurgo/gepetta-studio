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
  | { kind: "action"; key: string; label: string; actions: ControlOption[] }
  /**
   * A lens focus motor driven in repeatable fine steps (DSLRs). Commands go
   * through setControl as strings: "move:<±steps>" (+ = nearer), "zero" (drive
   * to the infinity end, position 0), "af" (autofocus), "af:<x>,<y>" (autofocus
   * at a point of the live image, 0..1).
   */
  | {
      kind: "focus";
      key: string;
      label: string;
      /** Steps from `origin`, or null when unknown (e.g. right after connecting). */
      position: number | null;
      /** What position 0 means: the infinity end, or wherever the last autofocus left the lens. */
      origin: "infinity" | "autofocus" | null;
      /** Known travel from infinity to the closest focus, in steps. */
      range: number;
      canPointFocus: boolean;
    }
  /**
   * Live-view magnification for checking focus. setControl values: a level
   * ("1", "5", "10") or "at:<x>,<y>" to move the magnified area's center (0..1).
   */
  | { kind: "magnify"; key: string; label: string; levels: ControlOption[]; value: string; center: [number, number] };

export interface ControlOption {
  value: string;
  label: string;
}

export type ControlValue = number | string | boolean;
