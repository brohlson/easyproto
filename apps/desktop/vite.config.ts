import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { compileTokens } from "./src/main/tokens";

const tokenFile = fileURLToPath(new URL("./src/renderer/design.tokens.json", import.meta.url));
const styleFiles = ["./src/renderer/styles.css", "../../packages/ui/select.css"].map((name) =>
  fileURLToPath(new URL(name, import.meta.url)),
);
const tokenModule = "virtual:desktop-design-tokens.css";
const resolvedTokenModule = "\0" + tokenModule;

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
  plugins: [
    {
      name: "desktop-design-tokens",
      resolveId(id) {
        if (id === tokenModule) return resolvedTokenModule;
      },
      async load(id) {
        if (id !== resolvedTokenModule) return;
        this.addWatchFile(tokenFile);
        for (const file of styleFiles) this.addWatchFile(file);
        const [source, ...styles] = await Promise.all([
          readFile(tokenFile, "utf8"),
          ...styleFiles.map((file) => readFile(file, "utf8")),
        ]);
        const { css, rows } = await compileTokens(source);
        const names = new Set(rows.map(({ cssName }) => cssName));
        for (const [, name] of styles.join("\n").matchAll(/var\((--ep-desktop-[\w-]+)/g)) {
          if (!names.has(name)) this.error(`Missing desktop design token ${name}.`);
        }
        return css;
      },
    },
  ],
});
