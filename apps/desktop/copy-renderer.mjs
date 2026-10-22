// Copies the built studio app and phone page next to the Electron bundle for packaging.
import { cpSync, rmSync } from "node:fs";

for (const [from, to] of [
  ["../studio/dist", "renderer"],
  ["../phone/dist", "phone"],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
