import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative paths so the built app also loads from file:// inside Electron.
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // File-change events (FSEvents) proved unreliable on some Macs: poll so edits always show up.
    watch: { usePolling: true, interval: 300 },
  },
});
