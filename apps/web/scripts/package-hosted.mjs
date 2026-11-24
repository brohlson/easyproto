import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [environment, databaseId] = process.argv.slice(2);
if (!["staging", "production"].includes(environment) || !/^[a-f0-9-]{36}$/.test(databaseId ?? "")) {
  throw new Error("Pass staging or production and the D1 database ID.");
}
const staging = environment === "staging";
const workerName = staging ? "easy-proto-web-staging" : "easy-proto-web";

const directory = await mkdtemp(join(tmpdir(), "easy-proto-hosted-"));
const output = join(directory, ".cloudflare", "output");
await mkdir(output, { recursive: true });
await cp(new URL("../.cloudflare/output/v1", import.meta.url), join(output, "v1"), {
  recursive: true,
});
const config = join(output, "v1", "workers", "default", "worker.config.json");
const worker = JSON.parse(await readFile(config, "utf8"));
worker.name = workerName;
worker.workersDev = false;
worker.previewUrls = false;
worker.env.DB = { type: "d1", name: workerName, id: databaseId };
worker.env.PREVIEWS = {
  type: "r2",
  name: staging ? "easy-proto-previews-staging" : "easy-proto-previews",
};
worker.env.VIEWER_ORIGIN.value = staging
  ? "https://staging.easyproto.app"
  : "https://easyproto.app";
worker.env.ARTIFACT_ORIGIN.value = staging
  ? "https://staging-preview.easyproto.app"
  : "https://preview.easyproto.app";
delete worker.env.LOCAL_PUBLISH_TOKEN;
worker.observability = {
  enabled: true,
  redactQueryString: true,
  logs: { enabled: true, invocationLogs: false },
  traces: { enabled: false },
};
await writeFile(config, JSON.stringify(worker, null, 2) + "\n");
console.log(directory);
