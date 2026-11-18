import { uprightRotation, watchOrientation } from "./orientation";
import {
  type CameraControl,
  type ControlValue,
  type DesktopMessage,
  applyTrackControl,
  modeStuck,
  readTrackControls,
} from "@gepetta/protocol";
import { setupHelp, statusPill } from "./common";
import { Connection } from "./connection";
import { h, toast } from "./dom";

/** Chrome's ImageCapture (not in TS's DOM lib). Gives full sensor resolution on Android. */
declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  takePhoto(settings?: Record<string, unknown>): Promise<Blob>;
  getPhotoCapabilities(): Promise<{ imageWidth?: { max: number }; imageHeight?: { max: number } }>;
}

const MAX_BUFFERED = 256 * 1024;

/**
 * The biggest photo within the camera's widest and tallest that keeps the
 * live picture's shape (the two maximums need not be one real size). Sizes are
 * the sensor's, which lies on its side: `aspect` is long side over short side.
 */
function biggestPhoto(maxWidth: number, maxHeight: number, aspect: number): { imageWidth: number; imageHeight: number } | undefined {
  if (!(aspect > 0)) return undefined;
  const width = Math.min(maxWidth, Math.round(maxHeight * aspect));
  return { imageWidth: width, imageHeight: Math.round(width / aspect) };
}

export function renderLive(root: HTMLElement) {
  const pill = statusPill();
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let controls: CameraControl[] = [];
  let facing: "environment" | "user" = "environment";
  // On the USB cable (the computer is this phone's "localhost") there is room for a bigger, smoother preview than over WiFi.
  let preview = location.hostname === "localhost" ? { maxWidth: 1280, fps: 20 } : { maxWidth: 640, fps: 10 };
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
      onOpen: () => {
        // A new connection starts with JPEG until the desktop asks for video again.
        videoAsked = false;
        sendControls();
      },
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
      case "previewVideo":
        videoAsked = true;
        needKey = true;
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
        // Full HD to watch: at the sensor's full size the camera gives only a few pictures a second.
        // Photos are taken apart, at the biggest size (see takePhoto). No frame rate is asked for: asking 30
        // made a Motorola give an upright 1080×1920 strip instead of the whole picture.
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (error) {
      showError(cameraErrorText(error));
      return false;
    }
    track = stream.getVideoTracks()[0] ?? null;
    video.srcObject = stream;
    // Not for ever: with the camera busy elsewhere (another tab), the picture never comes.
    await Promise.race([video.play().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
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
      if (modeStuck(track, control, value)) await reopenWith(key);
    } catch (error) {
      console.warn("applyConstraints", key, error);
      toast(`No se pudo cambiar “${control.label}”`, "error");
    }
    refreshControls();
  }

  /**
   * Opens the camera again, which is the only way some browsers go back to an
   * automatic mode (`mode`), and puts back the other settings as they were.
   */
  async function reopenWith(mode: string | null, before = controls) {
    if (!(await startCamera()) || !track) return;
    const fresh = readTrackControls(track);
    for (const was of before) {
      const now = fresh.find((c) => c.key === was.key);
      if (!now || was.key === mode || !("value" in was) || !("value" in now) || was.value === now.value) continue;
      // What the camera chooses by itself, and what `mode` governs, stay automatic.
      if (was.kind === "range" && (was.auto || was.manualMode === mode)) continue;
      if (was.kind === "choice" && was.value !== "manual") continue;
      await applyTrackControl(track, was, was.value).catch((error) => console.warn("applyConstraints", was.key, error));
    }
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
      // Lens-motor focus and magnifier only exist on DSLRs; a phone track never reports them.
      case "focus":
      case "magnify":
        return h("div", {});
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
  // As video (H.264, compressed by the phone's chip) when the desktop asks and the browser can; else JPEG after JPEG.
  const previewCanvas = document.createElement("canvas");
  let encoding = false;
  const VIDEO_CODEC = "avc1.42E01F";
  let videoAsked = false;
  let videoBroken = typeof VideoEncoder !== "function" || typeof video.requestVideoFrameCallback !== "function";
  let encoder: VideoEncoder | null = null;
  let encoderSize = "";
  let needKey = true;
  let lastKey = 0;
  const videoPreview = () => videoAsked && !videoBroken;

  function dropEncoder() {
    if (encoder && encoder.state !== "closed") encoder.close();
    encoder = null;
    encoderSize = "";
  }

  function videoLoop(_now: number, meta: VideoFrameCallbackMetadata) {
    video.requestVideoFrameCallback(videoLoop);
    if (!videoPreview() || capturing || !conn?.isOpen || !video.videoWidth) return;
    if (conn.bufferedAmount > MAX_BUFFERED || (encoder && encoder.encodeQueueSize > 2)) return;
    // The limit is for the long side; H.264 wants even sizes.
    const scale = Math.min(1, preview.maxWidth / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round((video.videoWidth * scale) / 2) * 2;
    const hgt = Math.round((video.videoHeight * scale) / 2) * 2;
    try {
      if (!encoder || encoderSize !== `${w}x${hgt}`) {
        dropEncoder();
        const made = new VideoEncoder({
          output: (chunk) => {
            const bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            conn?.send({ t: "video", key: chunk.type === "key", ts: chunk.timestamp, codec: VIDEO_CODEC, w, h: hgt, rotation: uprightRotation() }, bytes);
          },
          error: (error) => {
            console.warn("video preview", error);
            if (encoder === made) videoBroken = true;
          },
        });
        made.configure({ codec: VIDEO_CODEC, width: w, height: hgt, bitrate: Math.max(2_000_000, w * hgt * 8), framerate: 30, latencyMode: "realtime", avc: { format: "annexb" } });
        encoder = made;
        encoderSize = `${w}x${hgt}`;
        needKey = true;
      }
      const now = performance.now();
      // A key frame every couple of seconds, so a decoder that lost its way recovers.
      const key = needKey || now - lastKey > 2000;
      const frame = new VideoFrame(video, { timestamp: Math.round(meta.mediaTime * 1e6) });
      encoder.encode(frame, { keyFrame: key });
      frame.close();
      if (key) {
        needKey = false;
        lastKey = now;
      }
    } catch (error) {
      console.warn("video preview", error);
      videoBroken = true;
      dropEncoder();
    }
  }
  if (!videoBroken) video.requestVideoFrameCallback(videoLoop);

  function previewLoop() {
    window.setTimeout(previewLoop, 1000 / preview.fps);
    if (videoPreview()) return;
    if (encoding || capturing || document.hidden || !conn?.isOpen || conn.bufferedAmount > MAX_BUFFERED) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
    // The limit is for the long side: a phone held upright gives a tall picture.
    const scale = Math.min(1, preview.maxWidth / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const hgt = Math.round(video.videoHeight * scale);
    if (previewCanvas.width !== w || previewCanvas.height !== hgt) {
      previewCanvas.width = w;
      previewCanvas.height = hgt;
    }
    previewCanvas.getContext("2d")!.drawImage(video, 0, 0, w, hgt);
    encoding = true;
    void toJpeg(previewCanvas, 0.7)
      .then((bytes) => {
        if (bytes) conn?.send({ t: "preview", w, h: hgt, rotation: uprightRotation() }, bytes);
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
      const rotation = uprightRotation();
      const photo = await takePhoto();
      const sent = !!conn?.send({ t: "photo", requestId, mime: photo.mime, rotation }, photo.bytes);
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
        const capture = new ImageCapture(track);
        // The biggest photo the camera gives (the default can be smaller).
        const caps = await capture.getPhotoCapabilities().catch(() => null);
        const biggest = caps?.imageWidth?.max && caps.imageHeight?.max ? biggestPhoto(caps.imageWidth.max, caps.imageHeight.max, Math.max(video.videoWidth, video.videoHeight) / Math.min(video.videoWidth, video.videoHeight)) : undefined;
        const blob = await capture.takePhoto(biggest).catch((e) => {
          if (!biggest) throw e;
          return capture.takePhoto();
        });
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
  // Out of sight (another tab, the screen off) the camera is let go, so another
  // tab of this page can use it; back in sight it opens again as it was.
  let setAside: CameraControl[] | null = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!track) return;
      setAside = controls;
      stopCamera();
    } else if (setAside && !track && !superseded) {
      const before = setAside;
      setAside = null;
      void reopenWith(null, before).then(refreshControls);
    }
  });
  document.addEventListener("click", () => void keepAwake(), { once: true });
  // The motion sensor tells which way the phone is held (iOS asks permission on the first tap).
  void watchOrientation();
  document.addEventListener("click", () => void watchOrientation(), { once: true });

  /** Another tab of this page took the camera. */
  let superseded = false;

  // ---- Turning the phone ----
  // The camera keeps the shape it was opened with: turned afterwards, the picture is a strip cut from
  // the middle. Opening it again (with its settings) gives the whole picture the new way round.
  let turning: number | undefined;
  const onTurn = () => {
    clearTimeout(turning);
    turning = window.setTimeout(() => {
      if (!track || document.hidden || superseded || capturing) return;
      void reopenWith(null).then(refreshControls);
    }, 400);
  };
  if (window.screen.orientation?.addEventListener) window.screen.orientation.addEventListener("change", onTurn);
  else window.addEventListener("orientationchange", onTurn);

  // ---- One tab at a time ----
  // Every time the computer opens this page the browser makes a new tab; several holding the camera
  // leave all of them without picture. The newest keeps it: the others let go and say so.
  if (typeof BroadcastChannel === "function") {
    const tabs = new BroadcastChannel("gepetta-camara");
    tabs.postMessage("abierta");
    tabs.onmessage = () => {
      superseded = true;
      stopCamera();
      conn?.close();
      tabs.close();
      screen.replaceChildren(
        h("div", { class: "page error-page" }, h("h1", {}, "La cámara se abrió en otra pestaña"), h("p", { class: "muted" }, "Podés cerrar esta.")),
      );
    };
  }

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
    if (!ok || superseded) return stopCamera();
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
