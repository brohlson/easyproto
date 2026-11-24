import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./demo", import.meta.url)),
  esbuild: { jsx: "automatic" },
  build: {
    assetsInlineLimit: 0,
    outDir: "../dist",
    emptyOutDir: true,
  },
});
