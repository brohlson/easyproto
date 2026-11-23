import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await Promise.all([
  build({
    entryPoints: [
      "src/main/main.ts",
      "src/main/project.ts",
      "src/main/activity.ts",
      "src/main/web-preview.ts",
    ],
    outdir: "dist",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
    alias: {
      "@easy-proto/preview": fileURLToPath(
        new URL("../../../packages/preview/index.ts", import.meta.url),
      ),
    },
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
]);
