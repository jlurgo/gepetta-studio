import { defineConfig } from "vite";

// Served by the desktop app's LAN server from any path, so every URL must be relative.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "es2020" },
});
