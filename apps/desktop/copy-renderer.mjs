// Copies the built studio web app next to the Electron bundle for packaging.
import { cpSync, rmSync } from "node:fs";

rmSync("renderer", { recursive: true, force: true });
cpSync("../studio/dist", "renderer", { recursive: true });
