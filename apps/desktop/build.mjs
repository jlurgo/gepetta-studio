// Bundles the Electron main and preload scripts (TypeScript → CommonJS).
import { build } from "esbuild";

await build({
  entryPoints: { main: "src/main.ts", preload: "src/preload.ts" },
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // ws optionally requires these native speedups; it works without them.
  external: ["electron", "bufferutil", "utf-8-validate"],
  sourcemap: true,
  logLevel: "warning",
});
