import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/main/main.ts", "src/main/project.ts"],
    outdir: "dist",
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
]);
