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
    entryPoints: ["src/main/project.ts"],
    outfile: "dist/project.js",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
  }),
]);
