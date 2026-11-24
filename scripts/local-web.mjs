import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { inspectLocalServer, waitForLocalServer } from "./local-web-server.mjs";
import { enforcePrivateMode } from "./local-web-settings.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = join(root, "apps/web");
const desktop = join(root, "apps/desktop");
const command = process.argv[2] ?? "setup";
const local = join(root, ".local");
process.env.CLOUDFLARE_DEV_REGISTRY_PATH ??= join(local, "cloudflare-registry");
// Polling also works in sessions where native file watchers are restricted.
process.env.CHOKIDAR_USEPOLLING ??= "1";
const settingsFile = join(local, "web-preview.json");
const cf = join(web, "node_modules/.bin/cf");
const children = new Set();
let stopping = false;
const run = (program, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: web, stdio: "inherit", ...options });
    children.add(child);
    child.once("error", (failure) => {
      children.delete(child);
      reject(failure);
    });
    child.once("exit", (code) => {
      children.delete(child);
      return code === 0 && !stopping
        ? resolve()
        : reject(new Error(`${program.split("/").at(-1)} stopped (${code}).`));
    });
  });
function stop() {
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await mkdir(local, { recursive: true, mode: 0o700 });
await enforcePrivateMode(local, 0o700);
let settings;
try {
  settings = JSON.parse(await readFile(settingsFile, "utf8"));
} catch (failure) {
  if (failure.code !== "ENOENT") throw failure;
  settings = { origin: "http://127.0.0.1:8787", token: randomBytes(32).toString("base64url") };
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
await enforcePrivateMode(settingsFile, 0o600);
const origin = new URL(settings.origin);
if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password ||
  !/^[\w-]{43,128}$/.test(settings.token)
)
  throw new Error("Invalid local web preview settings.");
const varsFile = join(web, ".dev.vars");
let vars = await readFile(varsFile, "utf8").catch((failure) => {
  if (failure.code !== "ENOENT") throw failure;
  return "";
});
const found = /^LOCAL_PUBLISH_TOKEN=(.+)$/m.exec(vars);
if (found && found[1] !== JSON.stringify(settings.token) && found[1] !== settings.token)
  throw new Error(
    "The existing local publisher key differs between development settings. Reconcile it before starting.",
  );
if (!found) {
  vars += `${vars.endsWith("\n") || !vars ? "" : "\n"}LOCAL_PUBLISH_TOKEN=${JSON.stringify(settings.token)}\n`;
  await writeFile(varsFile, vars, { mode: 0o600 });
}
await enforcePrivateMode(varsFile, 0o600);
if (command === "prepare") {
  console.log("Prepared private local web preview settings.");
  process.exit(0);
}
await run(cf, [
  "d1",
  "migrations",
  "apply",
  "00000000-0000-4000-8000-000000000001",
  "--local",
  "--dir",
  "migrations",
]);
console.log("Local D1 schema is ready. Preview artifacts use local R2 storage.");
if (command === "setup") process.exit(0);
if (command !== "dev") throw new Error("Use setup or dev.");
await run(join(desktop, "node_modules/.bin/vite"), ["build"], { cwd: desktop });
await run(process.execPath, ["scripts/build.mjs"], { cwd: desktop });
try {
  if (await inspectLocalServer(settings)) {
    console.log(
      "Reusing the authenticated local preview server; it will stay running when the desktop closes.",
    );
  } else {
    if (stopping) throw new Error("Local development was stopped.");
    const website = spawn(cf, ["dev", "--host", "127.0.0.1", "--port", origin.port || "80"], {
      cwd: web,
      stdio: "inherit",
    });
    children.add(website);
    website.once("error", (failure) => {
      console.error(failure.message);
      stop();
      process.exitCode = 1;
    });
    website.once("exit", () => {
      children.delete(website);
      if (!stopping) {
        console.error("The local preview server exited unexpectedly.");
        process.exitCode = 1;
      }
      stop();
    });
    await waitForLocalServer(settings, website, () => stopping);
  }
  if (stopping) throw new Error("Local development was stopped.");
  let project = process.argv.slice(3).find((arg) => arg.startsWith("--project="));
  if (project) project = `--project=${resolve(root, project.slice("--project=".length))}`;
  if (!project) {
    const mock = join(local, "Mockups");
    try {
      await readFile(join(mock, "project.json"));
    } catch (failure) {
      if (failure.code !== "ENOENT") throw failure;
      await cp(join(root, "mocks/EasyProtoMocks"), mock, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    project = `--project=${mock}`;
  }
  if (stopping) throw new Error("Local development was stopped.");
  const app = spawn(join(desktop, "node_modules/.bin/electron"), [desktop, project], {
    cwd: desktop,
    stdio: "inherit",
    env: {
      ...process.env,
      EASY_PROTO_PROFILE: join(local, "desktop-profile"),
      EASY_PROTO_WEB_ORIGIN: settings.origin,
      EASY_PROTO_WEB_TOKEN: settings.token,
    },
  });
  children.add(app);
  app.once("error", (failure) => {
    console.error(failure.message);
    stop();
    process.exitCode = 1;
  });
  app.once("exit", (code, signal) => {
    children.delete(app);
    if (code || signal) {
      console.error(`The development desktop exited before completion (${signal || code}).`);
      process.exitCode = 1;
    }
    stop();
  });
  console.log(`Local preview: ${settings.origin}. Use Settings → Export page to web preview…`);
} catch (failure) {
  stop();
  throw failure;
}
