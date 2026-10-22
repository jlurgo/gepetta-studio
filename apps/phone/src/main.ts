import "./style.css";
import { renderLanding } from "./landing";
import { renderLive } from "./live";
import { renderPhoto } from "./photo";

/**
 * Views: landing (plain HTTP, what the QR opens), live camera (needs a secure
 * context) and photo mode (works anywhere). The hash picks a mode explicitly.
 */
function route() {
  const root = document.getElementById("app")!;
  const hash = location.hash.slice(1);
  root.replaceChildren();
  if (hash === "foto") renderPhoto(root);
  else if (hash === "vivo" || (window.isSecureContext && location.protocol === "https:")) renderLive(root);
  else renderLanding(root);
}

// Each view owns sockets and camera streams, so switching views reloads the page.
window.addEventListener("hashchange", () => location.reload());
route();
