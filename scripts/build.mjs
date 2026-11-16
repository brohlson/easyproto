import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.js",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
  }),
  build({
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/preload.cjs",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
  }),
  build({
    entryPoints: [
      "src/main/project.ts",
      "src/main/codex.ts",
      "src/main/chatgpt.ts",
      "src/main/agents.ts",
      "src/main/claude.ts",
    ],
    outdir: "dist",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
  }),
]);
