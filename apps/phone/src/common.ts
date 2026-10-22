import type { ConnectionStatus } from "./connection";
import { type Platform, detectPlatform, pairingToken } from "./device";
import { h } from "./dom";

export interface ServerInfo {
  httpsUrl: string;
  httpUrl: string;
  caUrl: string;
}

/** Addresses of this same server (secure and plain), as seen from the LAN. */
export async function fetchInfo(): Promise<ServerInfo> {
  const res = await fetch(`./info.json?t=${encodeURIComponent(pairingToken() ?? "")}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`info.json: ${res.status}`);
  return (await res.json()) as ServerInfo;
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Conectando…",
  open: "Conectado",
  reconnecting: "Reconectando…",
  "no-token": "Falta el código: escaneá el QR de nuevo",
};

export function statusPill(): { el: HTMLElement; set(status: ConnectionStatus): void } {
  const dot = h("span", { class: "dot" });
  const text = h("span", {}, STATUS_TEXT.connecting);
  const el = h("div", { class: "pill status-connecting", role: "status" }, dot, text);
  return {
    el,
    set(status) {
      el.className = `pill status-${status}`;
      text.textContent = STATUS_TEXT[status];
    },
  };
}

/** Collapsible certificate/setup instructions, the user's platform first. */
export function setupHelp(open = false): HTMLElement {
  const platform = detectPlatform();
  const caLink = h("a", { class: "btn small", href: "/ca.crt", download: "gepetta-ca.crt" }, "Descargar certificado");

  const android = h(
    "div",
    { class: "help-block" },
    h("h3", {}, "Android"),
    h(
      "p",
      {},
      "Si aparece ",
      h("b", {}, "“La conexión no es privada”"),
      ", tocá ",
      h("b", {}, "Avanzado → Continuar"),
      ". Es normal: la compu usa un certificado propio de la red local.",
    ),
  );
  const ios = h(
    "div",
    { class: "help-block" },
    h("h3", {}, "iPhone / iPad"),
    h("p", {}, "Hay que instalar un certificado una sola vez:"),
    h(
      "ol",
      {},
      h("li", {}, "Tocá ", caLink, " (abrilo con Safari)."),
      h("li", {}, "Andá a ", h("b", {}, "Ajustes → Perfil descargado → Instalar"), "."),
      h(
        "li",
        {},
        "Andá a ",
        h("b", {}, "Ajustes → General → Información → Ajustes de confianza de certificados"),
        " y activá ",
        h("b", {}, "“Gepetta Studio Local CA”"),
        ".",
      ),
      h("li", {}, "Volvé acá y tocá de nuevo “Cámara en vivo”."),
    ),
  );
  const blocks: Record<Exclude<Platform, "other">, HTMLElement> = { android, ios };
  const order = platform === "ios" ? [blocks.ios, blocks.android] : [blocks.android, blocks.ios];

  fetchInfo()
    .then((info) => caLink.setAttribute("href", info.caUrl))
    .catch(() => {});

  return h(
    "details",
    { class: "help", open },
    h("summary", {}, "¿Primera vez? Cómo prepararlo"),
    ...order,
  );
}
