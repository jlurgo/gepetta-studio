import { statusPill } from "./common";
import { Connection } from "./connection";
import { h, toast } from "./dom";

interface Shot {
  file: File;
  thumb: HTMLElement;
}

/** Photo mode: the native camera app (or the gallery) via <input type=file>, no secure context needed. */
export function renderPhoto(root: HTMLElement) {
  const pill = statusPill();
  const queue: Shot[] = [];
  let sending = false;
  let sentCount = 0;

  const conn = new Connection("photo", {
    onStatus: (status) => pill.set(status),
    onOpen: () => void pump(),
    onMessage: (header) => {
      if (header.t === "welcome") filmName.textContent = header.filmName ?? "";
    },
  });

  const filmName = h("span", { class: "film-name" });
  const counter = h("p", { class: "muted counter" }, "Todavía no mandaste fotos.");
  const strip = h("div", { class: "strip", "aria-label": "Fotos enviadas" });
  const done = h("div", { class: "sent-badge", "aria-hidden": "true" }, "¡Enviada!");

  const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden" });
  const galleryInput = h("input", { type: "file", accept: "image/*", multiple: true, class: "visually-hidden" });
  for (const input of [camInput, galleryInput]) {
    input.addEventListener("change", () => {
      for (const file of input.files ?? []) enqueue(file);
      input.value = "";
    });
  }

  function enqueue(file: File) {
    const url = URL.createObjectURL(file);
    const thumb = h("button", { class: "thumb pending", type: "button", title: file.name }, h("img", { src: url, alt: "" }));
    const shot = { file, thumb };
    thumb.addEventListener("click", () => {
      // Tapping a failed thumbnail retries it.
      if (!thumb.classList.contains("failed")) return;
      thumb.classList.replace("failed", "pending");
      queue.push(shot);
      void pump();
    });
    strip.prepend(thumb);
    queue.push(shot);
    void pump();
  }

  async function pump() {
    if (sending) return;
    sending = true;
    try {
      while (queue.length && conn.isOpen) {
        const shot = queue.shift()!;
        const bytes = new Uint8Array(await shot.file.arrayBuffer());
        const mime = shot.file.type || "image/jpeg";
        const ok = conn.send({ t: "photo", requestId: null, mime }, bytes) && (await conn.drained());
        shot.thumb.classList.remove("pending");
        if (ok) {
          shot.thumb.classList.add("sent");
          sentCount++;
          counter.textContent = sentCount === 1 ? "Mandaste 1 foto." : `Mandaste ${sentCount} fotos.`;
          done.classList.remove("show");
          void done.offsetWidth; // restart the animation
          done.classList.add("show");
        } else {
          shot.thumb.classList.add("failed");
          toast("No se pudo enviar. Tocá la foto para reintentar.", "error");
        }
      }
    } catch (error) {
      console.error(error);
      toast("No pude leer la foto.", "error");
    } finally {
      sending = false;
    }
    if (queue.length && !conn.isOpen) toast("Sin conexión: la foto sale apenas vuelva.");
  }

  const backLink = window.isSecureContext
    ? h("a", { class: "link", href: "#vivo" }, "Usar cámara en vivo")
    : h("a", { class: "link", href: "#" }, "Volver al inicio");

  root.append(
    h(
      "main",
      { class: "page photo" },
      h(
        "header",
        { class: "bar" },
        h("div", { class: "titles" }, h("h1", {}, "Foto simple"), filmName),
        pill.el,
      ),
      h(
        "label",
        { class: "big-shot" },
        camInput,
        h("span", { class: "big-shot-icon", "aria-hidden": "true" }, "📷"),
        h("span", {}, "Sacar foto"),
      ),
      h("label", { class: "btn wide" }, galleryInput, "Elegir de la galería"),
      done,
      counter,
      strip,
      h("p", { class: "hint muted" }, "Consejo: apoyá el celu firme y no muevas la cámara entre foto y foto."),
      backLink,
    ),
  );
}
