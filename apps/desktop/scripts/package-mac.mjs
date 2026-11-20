import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "@electron-forge/core";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("This package command targets Apple Silicon Macs.");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run pnpm desktop:package from the workspace.");

const desktop = new URL("../", import.meta.url);
const workspace = new URL("../../../", import.meta.url);
const output = new URL("dist/package/", desktop);
const temporary = await mkdtemp(join(tmpdir(), "easy-proto-package-"));
const stage = join(temporary, "app");

try {
  execFileSync(
    process.execPath,
    [
      pnpm,
      "--filter",
      "@easy-proto/desktop",
      "--config.inject-workspace-packages=true",
      "--config.node-linker=hoisted",
      "deploy",
      "--prod",
      stage,
    ],
    { cwd: workspace, stdio: "inherit" },
  );
  const modules = join(stage, "node_modules");
  await Promise.all([
    rm(join(stage, "pnpm-lock.yaml"), { force: true }),
    rm(join(modules, ".modules.yaml"), { force: true }),
    rm(join(modules, ".pnpm"), { recursive: true, force: true }),
    rm(join(modules, ".bin"), { recursive: true, force: true }),
  ]);
  const entries = await readdir(modules, { recursive: true, withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink()))
    throw new Error(
      "The staged production dependencies must contain only regular files and directories.",
    );

  const pkg = JSON.parse(await readFile(new URL("package.json", desktop), "utf8"));
  await mkdir(join(stage, "assets"));
  await Promise.all([
    copyFile(new URL("forge.config.mjs", desktop), join(stage, "forge.config.mjs")),
    copyFile(new URL("assets/app-icon.icns", desktop), join(stage, "assets", "app-icon.icns")),
  ]);
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify(
      {
        name: "easy-proto",
        productName: "Easy Proto",
        version: pkg.version,
        private: true,
        type: pkg.type,
        main: pkg.main,
        dependencies: pkg.dependencies,
        devDependencies: { electron: pkg.devDependencies.electron },
        config: { forge: "./forge.config.mjs" },
      },
      null,
      2,
    ) + "\n",
  );

  await api.package({
    dir: stage,
    arch: "arm64",
    platform: "darwin",
    outDir: fileURLToPath(output),
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
