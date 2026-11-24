import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  publicDir: fileURLToPath(new URL("../../packages/ui/public", import.meta.url)),
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        // This renderer is entirely client-side; React Server Component markers are inert here.
        if (
          level === "warn" &&
          log.code === "MODULE_LEVEL_DIRECTIVE" &&
          log.message.includes('directive "use client"')
        ) {
          return;
        }
        defaultHandler(level, log);
      },
    },
  },
  esbuild: { jsx: "automatic" },
});
