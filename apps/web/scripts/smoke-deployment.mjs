import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const [environment] = process.argv.slice(2);
assert.ok(["staging", "production"].includes(environment));
const staging = environment === "staging";
const viewer = staging ? "https://staging.easyproto.app" : "https://easyproto.app";
const artifacts = staging
  ? "https://staging-preview.easyproto.app"
  : "https://preview.easyproto.app";
const index = new URL(
  "../.cloudflare/output/v1/workers/default/assets/index.html",
  import.meta.url,
);

function buildId(html) {
  const data = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/)?.[1];
  assert.ok(data, "Next.js build data is missing");
  const id = JSON.parse(data).buildId;
  assert.equal(typeof id, "string");
  return id;
}

const expected = buildId(await readFile(index, "utf8"));

async function smoke() {
  const document = await fetch(viewer, { signal: AbortSignal.timeout(10000) });
  assert.equal(document.status, 200);
  assert.equal(document.headers.has("x-robots-tag"), staging);
  const html = await document.text();
  assert.equal(buildId(html), expected);
  assert.match(html, /<h1 id="landing-title">Easy Proto<\/h1>/);
  const script = html.match(/<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
  assert.ok(script);
  const chunk = await fetch(viewer + script, { signal: AbortSignal.timeout(10000) });
  assert.equal(chunk.status, 200);
  assert.match(chunk.headers.get("content-type") ?? "", /javascript/);
  assert.equal(
    (await fetch(viewer + "/shared-preview.html", { signal: AbortSignal.timeout(10000) })).status,
    404,
  );
  assert.equal(
    (await fetch(artifacts + "/api/health", { signal: AbortSignal.timeout(10000) })).status,
    404,
  );
  const health = await fetch(viewer + "/api/health", { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ready: true, service: "easy-proto-web" });

  if (staging) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(viewer, { timeout: 15000 });
      await page.locator("#landing-title").waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Join the waitlist" }).waitFor({ timeout: 10000 });
    } finally {
      await browser.close();
    }
  }
}

for (let attempt = 1; ; attempt++) {
  try {
    await smoke();
    console.log(`Verified ${viewer} on Next.js build ${expected}`);
    break;
  } catch (error) {
    if (attempt === 4) throw error;
    await setTimeout(5000);
  }
}
