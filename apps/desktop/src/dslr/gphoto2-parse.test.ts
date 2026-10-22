import { describe, expect, it } from "vitest";
import { MSG_BUSY, MSG_BUSY_WINDOWS, classifyGphotoError, parseAutoDetect, parseConfigList, rawMimeOf, toCameraControls } from "./gphoto2-parse";

describe("parseAutoDetect", () => {
  it("parses models with spaces and skips the header", () => {
    const out = [
      "Model                          Port            ",
      "----------------------------------------------------------",
      "Canon EOS 600D                 usb:020,005     ",
      "Nikon DSC D5300                usb:020,007",
      "Mass Storage Camera            disk:/Volumes/EOS_DIGITAL",
      "",
    ].join("\n");
    expect(parseAutoDetect(out)).toEqual([
      { id: "usb:020,005", model: "Canon EOS 600D" },
      { id: "usb:020,007", model: "Nikon DSC D5300" },
    ]);
  });

  it("returns nothing when no camera is connected (real gphoto2 2.5.32 output)", () => {
    const out = "Model                          Port            \n----------------------------------------------------------\n";
    expect(parseAutoDetect(out)).toEqual([]);
  });
});

/** Trimmed `gphoto2 --list-all-config` from a Canon EOS (shape of libgphoto2 2.5.x). */
const CANON_CONFIG = `/main/actions/syncdatetime
Label: Synchronize camera date and time with PC
Readonly: 0
Type: TOGGLE
Current: 0
END
/main/actions/autofocusdrive
Label: Drive Canon DSLR Autofocus
Readonly: 0
Type: TOGGLE
Current: 0
END
/main/actions/manualfocusdrive
Label: Drive Canon DSLR Manual focus
Readonly: 0
Type: RADIO
Current: None
Choice: 0 Near 1
Choice: 1 Near 2
Choice: 2 Near 3
Choice: 3 None
Choice: 4 Far 1
Choice: 5 Far 2
Choice: 6 Far 3
END
/main/actions/viewfinder
Label: Canon EOS Viewfinder
Readonly: 0
Type: TOGGLE
Current: 0
END
/main/settings/datetime
Label: Camera Date and Time
Readonly: 0
Type: DATE
Current: 1761134400
Printable: Wed Oct 22 10:00:00 2025
Help: Use 'now' as the current time when setting.

END
/main/settings/ownername
Label: Owner Name
Readonly: 0
Type: TEXT
Current:
END
/main/settings/capturetarget
Label: Capture Target
Readonly: 0
Type: RADIO
Current: Internal RAM
Choice: 0 Internal RAM
Choice: 1 Memory card
END
/main/imgsettings/imageformat
Label: Image Format
Readonly: 0
Type: RADIO
Current: RAW + Large Fine JPEG
Choice: 0 Large Fine JPEG
Choice: 1 Large Normal JPEG
Choice: 2 Small Fine JPEG
Choice: 3 RAW + Large Fine JPEG
Choice: 4 RAW
END
/main/imgsettings/iso
Label: ISO Speed
Readonly: 0
Type: RADIO
Current: 400
Choice: 0 Auto
Choice: 1 100
Choice: 2 200
Choice: 3 400
Choice: 4 800
END
/main/imgsettings/whitebalance
Label: WhiteBalance
Readonly: 0
Type: RADIO
Current: Daylight
Choice: 0 Auto
Choice: 1 Daylight
Choice: 2 Shadow
Choice: 3 Cloudy
Choice: 4 Tungsten
Choice: 5 Fluorescent
Choice: 6 Flash
Choice: 7 Manual
END
/main/imgsettings/colortemperature
Label: Color Temperature
Readonly: 0
Type: RADIO
Current: 5200
Choice: 0 2500
Choice: 1 5200
Choice: 2 10000
END
/main/capturesettings/exposurecompensation
Label: Exposure Compensation
Readonly: 0
Type: RADIO
Current: 0
Choice: 0 -1
Choice: 1 -0.666
Choice: 2 -0.333
Choice: 3 0
Choice: 4 0.333
END
/main/capturesettings/focusmode
Label: Focus Mode
Readonly: 0
Type: RADIO
Current: One Shot
Choice: 0 One Shot
Choice: 1 AI Focus
Choice: 2 AI Servo
END
/main/capturesettings/aperture
Label: Aperture
Readonly: 0
Type: RADIO
Current: 5.6
Choice: 0 4
Choice: 1 5.6
Choice: 2 8
END
/main/capturesettings/shutterspeed
Label: Shutter Speed
Readonly: 0
Type: RADIO
Current: 1/60
Choice: 0 bulb
Choice: 1 30
Choice: 2 1/60
Choice: 3 1/4000
END
/main/capturesettings/picturestyle
Label: Picture Style
Readonly: 0
Type: RADIO
Current: Standard
Choice: 0 Standard
Choice: 1 Portrait
Choice: 2 User defined 1
END
/main/capturesettings/drivemode
Label: Drive Mode
Readonly: 1
Type: RADIO
Current: Single
Choice: 0 Single
Choice: 1 Continuous
END
/main/capturesettings/autoexposuremode
Label: Canon Auto Exposure Mode
Readonly: 1
Type: RADIO
Current: Manual
Choice: 0 P
Choice: 1 Manual
END
/main/status/model
Label: Camera Model
Readonly: 1
Type: TEXT
Current: Canon EOS 600D
END
`;

describe("parseConfigList", () => {
  const entries = parseConfigList(CANON_CONFIG);

  it("parses every block", () => {
    expect(entries).toHaveLength(19);
    expect(entries.find((e) => e.name === "iso")).toEqual({
      path: "/main/imgsettings/iso",
      name: "iso",
      label: "ISO Speed",
      readonly: false,
      type: "RADIO",
      current: "400",
      choices: ["Auto", "100", "200", "400", "800"],
    });
    expect(entries.find((e) => e.name === "ownername")?.current).toBe("");
    expect(entries.find((e) => e.name === "drivemode")?.readonly).toBe(true);
    expect(entries.find((e) => e.name === "manualfocusdrive")?.choices).toContain("Far 3");
  });

  it("parses RANGE limits", () => {
    const [e] = parseConfigList(
      "/main/capturesettings/exposurecompensation\nLabel: Exposure Compensation\nReadonly: 0\nType: RANGE\nCurrent: -1\nBottom: -5\nTop: 5\nStep: 0.333\nEND\n",
    );
    expect(e).toMatchObject({ type: "RANGE", current: "-1", bottom: -5, top: 5, step: 0.333 });
  });
});

describe("toCameraControls", () => {
  const controls = toCameraControls(parseConfigList(CANON_CONFIG));

  it("keeps the curated, writable settings in order, then focus actions", () => {
    expect(controls.map((c) => c.key)).toEqual([
      "imageformat",
      "iso",
      "aperture",
      "shutterspeed",
      "exposurecompensation",
      "whitebalance",
      "colortemperature",
      "focusmode",
      "picturestyle",
      "manualfocusdrive",
      "autofocusdrive",
    ]);
  });

  it("uses gphoto2 values with Spanish labels", () => {
    const format = controls.find((c) => c.key === "imageformat");
    expect(format).toMatchObject({ kind: "choice", label: "Formato de imagen", value: "RAW + Large Fine JPEG" });
    if (format?.kind !== "choice") throw new Error("expected a choice");
    expect(format.options.find((o) => o.value === "RAW + Large Fine JPEG")?.label).toContain("RAW+JPEG");
    const aperture = controls.find((c) => c.key === "aperture");
    expect(aperture).toMatchObject({ label: "Diafragma", value: "5.6" });
    if (aperture?.kind !== "choice") throw new Error("expected a choice");
    expect(aperture.options[1]).toEqual({ value: "5.6", label: "f/5.6" });
    expect(controls.find((c) => c.key === "whitebalance")).toMatchObject({ label: "Balance de blancos" });
  });

  it("labels letter-coded EOS image formats (as reported by a real EOS 500D)", () => {
    const [format] = toCameraControls(
      parseConfigList(
        "/main/imgsettings/imageformat\nLabel: Image Format\nReadonly: 0\nType: RADIO\nCurrent: L\n" +
          "Choice: 0 L\nChoice: 1 cL\nChoice: 2 S\nChoice: 3 RAW + L\nChoice: 4 RAW\nEND\n",
      ),
    );
    if (format?.kind !== "choice") throw new Error("expected a choice");
    expect(format.options.map((o) => o.label)).toEqual([
      "JPEG grande (fina)",
      "JPEG grande (normal)",
      "JPEG chico (fina)",
      "RAW+JPEG (RAW + L)",
      "Solo RAW (RAW)",
    ]);
  });

  it("offers manual focus steps near→far", () => {
    expect(controls.find((c) => c.key === "manualfocusdrive")).toEqual({
      kind: "action",
      key: "manualfocusdrive",
      label: "Foco manual",
      actions: [
        { value: "Near 3", label: "◀◀◀ Cerca" },
        { value: "Near 2", label: "◀◀ Cerca" },
        { value: "Near 1", label: "◀ Cerca" },
        { value: "Far 1", label: "Lejos ▶" },
        { value: "Far 2", label: "Lejos ▶▶" },
        { value: "Far 3", label: "Lejos ▶▶▶" },
      ],
    });
  });

  it("maps f-number (Nikon) to Diafragma and RANGE to a range control", () => {
    const out = toCameraControls(
      parseConfigList(
        "/main/capturesettings/f-number\nLabel: F-Number\nReadonly: 0\nType: RADIO\nCurrent: f/8\nChoice: 0 f/4\nChoice: 1 f/8\nEND\n" +
          "/main/capturesettings/exposurecompensation\nLabel: Exposure Compensation\nReadonly: 0\nType: RANGE\nCurrent: 0\nBottom: -5\nTop: 5\nStep: 0.333\nEND\n",
      ),
    );
    expect(out[0]).toMatchObject({ key: "f-number", label: "Diafragma", value: "f/8" });
    expect(out[1]).toEqual({ kind: "range", key: "exposurecompensation", label: "Compensación de exposición", min: -5, max: 5, step: 0.333, value: 0 });
  });
});

describe("classifyGphotoError", () => {
  it("detects a camera held by another program", () => {
    const stderr = `
*** Error ***
An error occurred in the io-library ('Could not claim the USB device'): Could not claim interface 0 (Permission denied). Make sure no other program (gvfs-gphoto2-volume-monitor) or kernel module (such as sdc2xx, stv680, spca50x) is using the device and you have read/write access to the device.
*** Error (-53: 'Could not claim the USB device') ***`;
    expect(classifyGphotoError(stderr, false, "darwin")).toEqual({ code: "busy", message: MSG_BUSY });
    expect(classifyGphotoError(stderr, false, "win32")).toEqual({ code: "busy", message: MSG_BUSY_WINDOWS });
  });

  it("detects a missing camera (real gphoto2 2.5.32 output, no camera plugged)", () => {
    const stderr = `
*** Error ***
Could not detect any camera

*** Error ***
An error occurred in the io-library ('Unknown error'): No error description available
*** Error (-105: 'Unknown model') ***

For debugging messages, please use the --debug option.`;
    expect(classifyGphotoError(stderr).code).toBe("disconnected");
  });

  it("treats I/O errors as a disconnect only once the camera had worked", () => {
    const stderr = "*** Error (-7: 'I/O problem') ***";
    expect(classifyGphotoError(stderr, true).code).toBe("disconnected");
    expect(classifyGphotoError(stderr, false).code).toBe("failed");
  });

  it("falls back to a Spanish message with the detail", () => {
    const r = classifyGphotoError("*** Error (-2: 'Bad parameters') ***");
    expect(r.code).toBe("failed");
    expect(r.message).toMatch(/^La cámara no pudo hacerlo \(Error \(-2: 'Bad parameters'\)\)\.$/);
  });
});

describe("rawMimeOf", () => {
  it("knows common RAW extensions", () => {
    expect(rawMimeOf("CR2")).toBe("image/x-canon-cr2");
    expect(rawMimeOf("cr3")).toBe("image/x-canon-cr3");
    expect(rawMimeOf("nef")).toBe("image/x-nikon-nef");
    expect(rawMimeOf("iiq")).toBe("image/x-raw");
    expect(rawMimeOf("jpg")).toBeNull();
  });
});
