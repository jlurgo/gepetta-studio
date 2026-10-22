import { fetchInfo, setupHelp } from "./common";
import { h } from "./dom";

export function renderLanding(root: HTMLElement) {
  const liveError = h("p", { class: "error-text", hidden: true });
  const liveBtn = h(
    "button",
    { class: "choice primary", type: "button" },
    h("span", { class: "choice-icon", "aria-hidden": "true" }, "🎥"),
    h(
      "span",
      { class: "choice-body" },
      h("span", { class: "choice-title" }, "Cámara en vivo ", h("span", { class: "tag" }, "recomendado")),
      h(
        "span",
        { class: "choice-text" },
        "Ves la cámara del celu en la compu, con vista previa y papel de cebolla. Sacás fotos desde acá o desde la compu.",
      ),
    ),
  );
  const photoBtn = h(
    "a",
    { class: "choice", href: "#foto" },
    h("span", { class: "choice-icon", "aria-hidden": "true" }, "📷"),
    h(
      "span",
      { class: "choice-body" },
      h("span", { class: "choice-title" }, "Foto simple"),
      h(
        "span",
        { class: "choice-text" },
        "Sin configurar nada: usás la cámara normal del celu y cada foto llega a la compu.",
      ),
    ),
  );

  liveBtn.addEventListener("click", async () => {
    // getUserMedia only works in a secure context; localhost already is one.
    if (window.isSecureContext) {
      location.hash = "vivo";
      return;
    }
    liveBtn.disabled = true;
    liveError.hidden = true;
    try {
      const info = await fetchInfo();
      location.href = info.httpsUrl;
    } catch {
      liveBtn.disabled = false;
      liveError.textContent = "No pude averiguar la dirección segura de la compu. ¿Sigue abierta Gepetta Studio?";
      liveError.hidden = false;
    }
  });

  root.append(
    h(
      "main",
      { class: "page landing" },
      h(
        "header",
        { class: "landing-head" },
        h("img", { class: "logo", src: "./icon.svg", alt: "" }),
        h("h1", {}, "Gepetta Studio · Cámara"),
        h("p", { class: "muted" }, "¿Cómo querés usar el celu?"),
      ),
      liveBtn,
      liveError,
      setupHelp(),
      photoBtn,
    ),
  );
}
