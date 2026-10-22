import {
  type CameraControl,
  type ControlValue,
  type DesktopMessage,
  applyTrackControl,
  readTrackControls,
} from "@gepetta/protocol";
import { setupHelp, statusPill } from "./common";
import { Connection } from "./connection";
import { h, toast } from "./dom";

/** Chrome's ImageCapture (not in TS's DOM lib). Gives full sensor resolution on Android. */
declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  takePhoto(settings?: Record<string, unknown>): Promise<Blob>;
}

const MAX_BUFFERED = 256 * 1024;

export function renderLive(root: HTMLElement) {
  const pill = statusPill();
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let controls: CameraControl[] = [];
  let facing: "environment" | "user" = "environment";
  let preview = { maxWidth: 640, fps: 10 };
  let onionUrl: string | null = null;
  let capturing = false;

  // ---- DOM ----
  const video = h("video", { class: "feed", autoplay: true, muted: true, playsinline: true });
  video.muted = true;
  const onion = h("img", { class: "onion", alt: "", hidden: true });
  const flash = h("div", { class: "flash" });
  const filmName = h("span", { class: "film-name" });
  const shutter = h("button", { class: "shutter", type: "button", "aria-label": "Sacar foto" }, h("span"));
  const onionBtn = h("button", { class: "round", type: "button", "aria-pressed": "true", disabled: true, title: "Papel de cebolla" }, "🧅");
  const onionSlider = h("input", { type: "range", min: 0.1, max: 0.9, step: 0.05, value: 0.4, "aria-label": "Opacidad del papel de cebolla" });
  const onionBar = h("div", { class: "onion-bar", hidden: true }, h("span", {}, "Cebolla"), onionSlider);
  const flipBtn = h("button", { class: "round", type: "button", hidden: true, title: "Cambiar de cámara" }, "🔄");
  const settingsBtn = h("button", { class: "round", type: "button", title: "Ajustes de cámara" }, "⚙️");
  const drawerList = h("div", { class: "controls" });
  const drawer = h(
    "aside",
    { class: "drawer", hidden: true },
    h(
      "div",
      { class: "drawer-head" },
      h("h2", {}, "Ajustes de cámara"),
      h("button", { class: "round small", type: "button", "aria-label": "Cerrar", "data-close": true }, "✕"),
    ),
    drawerList,
  );
  const stage = h("div", { class: "stage" }, video, onion, flash);

  const screen = h(
    "main",
    { class: "live" },
    stage,
    h(
      "header",
      { class: "bar overlay" },
      h("div", { class: "titles" }, h("h1", {}, "Gepetta · Cámara"), filmName),
      pill.el,
    ),
    onionBar,
    h("nav", { class: "dock" }, h("div", { class: "dock-side" }, onionBtn, flipBtn), shutter, h("div", { class: "dock-side" }, settingsBtn)),
    drawer,
    h("a", { class: "link photo-link", href: "#foto" }, "Modo foto simple"),
  );
  root.append(screen);

  // ---- Connection ----
  // Created once the camera works, so the computer never sees a camera without image.
  let conn: Connection | null = null;
  function connect() {
    conn = new Connection("live", {
      onStatus: (status) => pill.set(status),
      onOpen: () => sendControls(),
      onMessage: (header, payload) => void handleMessage(header, payload),
    });
  }

  async function handleMessage(header: DesktopMessage, payload: Uint8Array | null) {
    switch (header.t) {
      case "welcome":
        filmName.textContent = header.filmName ?? "";
        break;
      case "capture":
        await takeAndSend(header.requestId);
        break;
      case "setControl":
        await setControl(header.key, header.value);
        break;
      case "onion":
        if (header.filmName) filmName.textContent = header.filmName;
        setOnion(payload);
        break;
      case "previewSettings":
        preview = {
          maxWidth: clamp(Math.round(header.maxWidth) || 640, 160, 1920),
          fps: clamp(header.fps || 10, 1, 30),
        };
        break;
    }
  }

  function sendControls() {
    conn?.send({ t: "controls", controls });
  }

  // ---- Camera ----
  async function startCamera(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Este navegador no deja usar la cámara desde esta dirección (hace falta la conexión segura).");
      return false;
    }
    stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
    } catch (error) {
      showError(cameraErrorText(error));
      return false;
    }
    track = stream.getVideoTracks()[0] ?? null;
    video.srcObject = stream;
    await video.play().catch(() => {});
    refreshControls();
    void checkMultipleCameras();
    return true;
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    track = null;
  }

  async function checkMultipleCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      flipBtn.hidden = devices.filter((d) => d.kind === "videoinput").length < 2;
    } catch {
      flipBtn.hidden = true;
    }
  }

  flipBtn.addEventListener("click", async () => {
    facing = facing === "environment" ? "user" : "environment";
    flipBtn.disabled = true;
    await startCamera();
    flipBtn.disabled = false;
    stage.classList.toggle("mirrored", facing === "user");
  });

  // ---- Controls ----
  let dragging = false;

  function refreshControls() {
    controls = track ? readTrackControls(track) : [];
    sendControls();
    if (!dragging) renderControls();
  }

  async function setControl(key: string, value: ControlValue) {
    const control = controls.find((c) => c.key === key);
    if (!track || !control) return;
    try {
      await applyTrackControl(track, control, value);
    } catch (error) {
      console.warn("applyConstraints", key, error);
      toast(`No se pudo cambiar “${control.label}”`, "error");
    }
    refreshControls();
  }

  /** Applies slider values one at a time, always ending with the latest one. */
  function throttledSetter(key: string) {
    let busy = false;
    let pending: ControlValue | null = null;
    return async function set(value: ControlValue) {
      pending = value;
      if (busy) return;
      busy = true;
      while (pending !== null) {
        const next = pending;
        pending = null;
        await setControl(key, next);
      }
      busy = false;
    };
  }

  function renderControls() {
    drawerList.replaceChildren();
    if (!controls.length) {
      drawerList.append(h("p", { class: "muted" }, "Este celular no deja ajustar la cámara desde el navegador. Igual podés sacar fotos."));
      return;
    }
    for (const control of controls) drawerList.append(controlRow(control));
  }

  function controlRow(control: CameraControl): HTMLElement {
    const label = h("span", { class: "control-label" }, control.label);
    switch (control.kind) {
      case "range": {
        const out = h("output", {}, formatNumber(control.value));
        const input = h("input", { type: "range", min: control.min, max: control.max, step: control.step, value: control.value });
        const set = throttledSetter(control.key);
        input.addEventListener("input", () => {
          dragging = true;
          out.textContent = formatNumber(input.valueAsNumber);
          void set(input.valueAsNumber);
        });
        input.addEventListener("change", () => {
          dragging = false;
          void set(input.valueAsNumber).then(() => renderControls());
        });
        return h("label", { class: "control" }, h("span", { class: "control-top" }, label, out), input);
      }
      case "choice": {
        const select = h("select", {});
        for (const option of control.options) {
          select.append(h("option", { value: option.value, selected: option.value === control.value }, option.label));
        }
        select.addEventListener("change", () => void setControl(control.key, select.value));
        return h("label", { class: "control row" }, label, select);
      }
      case "toggle": {
        const input = h("input", { type: "checkbox", role: "switch", class: "switch", checked: control.value });
        input.addEventListener("change", () => void setControl(control.key, input.checked));
        return h("label", { class: "control row" }, label, input);
      }
      case "action": {
        const buttons = control.actions.map((action) => {
          const btn = h("button", { class: "btn small", type: "button" }, action.label);
          btn.addEventListener("click", () => void setControl(control.key, action.value));
          return btn;
        });
        return h("div", { class: "control" }, label, h("div", { class: "actions" }, ...buttons));
      }
    }
  }

  settingsBtn.addEventListener("click", () => {
    renderControls();
    drawer.hidden = !drawer.hidden;
  });
  drawer.querySelector("[data-close]")!.addEventListener("click", () => (drawer.hidden = true));

  // ---- Onion skin ----
  function setOnion(payload: Uint8Array | null) {
    if (onionUrl) URL.revokeObjectURL(onionUrl);
    onionUrl = payload ? URL.createObjectURL(new Blob([payload as Uint8Array<ArrayBuffer>], { type: "image/jpeg" })) : null;
    onionBtn.disabled = !onionUrl;
    if (onionUrl) onion.src = onionUrl;
    else onion.removeAttribute("src");
    updateOnion();
  }

  function updateOnion() {
    const on = !!onionUrl && onionBtn.getAttribute("aria-pressed") === "true";
    onion.hidden = !on;
    onionBar.hidden = !on;
    onion.style.opacity = onionSlider.value;
  }

  onionBtn.addEventListener("click", () => {
    onionBtn.setAttribute("aria-pressed", String(onionBtn.getAttribute("aria-pressed") !== "true"));
    updateOnion();
  });
  onionSlider.addEventListener("input", updateOnion);

  // ---- Preview stream ----
  const previewCanvas = document.createElement("canvas");
  let encoding = false;

  function previewLoop() {
    window.setTimeout(previewLoop, 1000 / preview.fps);
    if (encoding || capturing || document.hidden || !conn?.isOpen || conn.bufferedAmount > MAX_BUFFERED) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
    const w = Math.min(preview.maxWidth, video.videoWidth);
    const hgt = Math.round((video.videoHeight * w) / video.videoWidth);
    if (previewCanvas.width !== w || previewCanvas.height !== hgt) {
      previewCanvas.width = w;
      previewCanvas.height = hgt;
    }
    previewCanvas.getContext("2d")!.drawImage(video, 0, 0, w, hgt);
    encoding = true;
    void toJpeg(previewCanvas, 0.7)
      .then((bytes) => {
        if (bytes) conn?.send({ t: "preview", w, h: hgt }, bytes);
      })
      .finally(() => (encoding = false));
  }

  // ---- Capture ----
  async function takeAndSend(requestId: string | null) {
    if (capturing) {
      if (requestId) conn?.send({ t: "error", requestId, message: "Ya estoy sacando una foto" });
      return;
    }
    capturing = true;
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
    try {
      const photo = await takePhoto();
      const sent = !!conn?.send({ t: "photo", requestId, mime: photo.mime }, photo.bytes);
      if (!sent) toast("Sin conexión con la compu: la foto no se envió.", "error");
      else if (!requestId) toast("¡Foto enviada!");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("capture", error);
      if (requestId) conn?.send({ t: "error", requestId, message });
      toast("No se pudo sacar la foto.", "error");
    } finally {
      capturing = false;
    }
  }

  async function takePhoto(): Promise<{ bytes: Uint8Array; mime: string }> {
    if (!track || track.readyState !== "live") throw new Error("La cámara no está activa");
    if (typeof window.ImageCapture === "function") {
      try {
        const blob = await new ImageCapture(track).takePhoto();
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || "image/jpeg" };
      } catch (error) {
        console.warn("takePhoto failed, using the video frame", error);
      }
    }
    if (!video.videoWidth) throw new Error("La cámara todavía no tiene imagen");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const bytes = await toJpeg(canvas, 0.95);
    canvas.width = canvas.height = 0; // free the memory now (iOS is strict about canvas memory)
    if (!bytes) throw new Error("No se pudo codificar la foto");
    return { bytes, mime: "image/jpeg" };
  }

  shutter.addEventListener("click", () => void takeAndSend(null));

  // ---- Wake lock ----
  let wakeLock: WakeLockSentinel | null = null;
  async function keepAwake() {
    if (!("wakeLock" in navigator) || document.hidden || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } catch {
      // Not allowed (low battery, no user gesture yet…); not critical.
    }
  }
  document.addEventListener("visibilitychange", () => void keepAwake());
  document.addEventListener("click", () => void keepAwake(), { once: true });

  // ---- Errors ----
  function showError(message: string) {
    stopCamera();
    conn?.close();
    const retry = h("button", { class: "btn wide", type: "button" }, "Probar de nuevo");
    retry.addEventListener("click", () => location.reload());
    screen.replaceChildren(
      h(
        "div",
        { class: "page error-page" },
        h("h1", {}, "No pude abrir la cámara"),
        h("p", { class: "error-text" }, message),
        h("a", { class: "btn wide primary", href: "#foto" }, "Usar foto simple"),
        retry,
        setupHelp(true),
      ),
    );
  }

  void startCamera().then((ok) => {
    if (!ok) return;
    connect();
    void keepAwake();
    previewLoop();
  });
}

function cameraErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "No diste permiso para usar la cámara. Habilitalo en los ajustes del navegador para este sitio y probá de nuevo.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No encontré ninguna cámara en este dispositivo.";
    case "NotReadableError":
    case "AbortError":
      return "La cámara está ocupada. Cerrá otras apps que la estén usando y probá de nuevo.";
    default:
      return `Algo salió mal al abrir la cámara${error instanceof Error ? ` (${error.message})` : ""}.`;
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) resolve(null);
        else blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), () => resolve(null));
      },
      "image/jpeg",
      quality,
    );
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 10 ? 2 : 0);
}

declare global {
  interface Window {
    ImageCapture?: typeof ImageCapture;
  }
}
