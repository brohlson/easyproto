import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { previewHtml } from "@easy-proto/preview";
import { chromium } from "playwright";
import { checkWorkspaceHeader } from "../../scripts/workspace-header-check.mjs";
import { png } from "./fixtures/png.mjs";
import { workerFixture } from "./fixtures/worker.mjs";
import { copyFormats, readSharedTokens } from "./src/shared-viewer/tokens.ts";
import { test } from "node:test";
import worker from "./worker/index.ts";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const member = (bytes) => ({ bytes: bytes.length, digest: digest(bytes) });

async function fixture(t) {
  const { database, objects, token, env } = await workerFixture(t);
  const projectId = randomUUID();
  const pageId = randomUUID();
  const artboardId = randomUUID();
  const rawHtml =
    '<html><head></head><body><h1>Live board</h1><script>parent.pwned=1</script><button onclick="fetch(\'https://example.test\')">No</button><a href="https://example.test">Link</a><iframe src="https://example.test"></iframe><img src="assets/pixel.png"></body></html>';
  const document = Buffer.from(previewHtml(rawHtml, false));
  const stylesheet = Buffer.from(
    "body{margin:0;color:rgb(12,34,56);background-image:url(assets/pixel.png)}",
  );
  const image = png();
  const metadata = {
    projectId,
    pageId,
    manifest: {
      schemaVersion: 2,
      projectName: "Notes",
      pageName: "Concepts",
      revision: 1,
      artboards: [
        {
          id: artboardId,
          name: "Home",
          x: -400,
          y: 120,
          width: 100,
          height: 100,
          document: member(document),
          stylesheet: member(stylesheet),
          assets: [{ path: "pixel.png", mime: "image/png", ...member(image) }],
        },
      ],
    },
  };
  function sync(payload = metadata, files = {}, extraHeaders = {}) {
    const board = payload.manifest.artboards[0];
    const body = new FormData();
    body.set("manifest", JSON.stringify(payload));
    body.set(
      `${board.id}:document`,
      new Blob([files.document ?? document], { type: "text/html" }),
      "index.html",
    );
    body.set(
      `${board.id}:stylesheet`,
      new Blob([files.stylesheet ?? stylesheet], { type: "text/css" }),
      "board.css",
    );
    if (files.tokens)
      body.set(`${board.id}:tokens`, new Blob([files.tokens], { type: "text/css" }), "tokens.css");
    body.set(
      `${board.id}:asset:0`,
      new Blob([files.image ?? image], { type: "image/png" }),
      "pixel.png",
    );
    if (files.extra) body.set("unexpected", new Blob(["x"]), "x.txt");
    if (files.access) body.set("access", files.access);
    return worker.fetch(
      new Request(files.endpoint ?? "http://127.0.0.1:8787/api/local/sync", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          ...(files.endpoint ? { "idempotency-key": files.requestId ?? randomUUID() } : {}),
          ...extraHeaders,
        },
        body,
      }),
      env,
    );
  }
  return { database, objects, env, metadata, document, image, rawHtml, sync, token };
}

test("only the public homepage is indexable and its discovery metadata is in the initial HTML", async (t) => {
  const { env } = await workerFixture(t);
  const production = "https://easyproto.app";
  const staging = "https://staging.easyproto.app";
  const workerEnv = (origin) => ({
    ...env,
    VIEWER_ORIGIN: origin,
    ARTIFACT_ORIGIN: "https://preview.easyproto.app",
    SHARE_KEY: "s".repeat(43),
  });
  const call = (origin, path = "/", options) =>
    worker.fetch(new Request(origin + path, options), workerEnv(origin));
  const response = await call(production, "/?source=test");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), null);
  assert.equal((await call(production, "/", { method: "HEAD" })).headers.get("x-robots-tag"), null);
  const markup = await response.text();
  const tagline =
    "Easy Proto is a free, open-source tool that brings prototyping, design tokens, and component management into a single workspace.";
  assert.ok(markup.includes(`<meta name="description" content="${tagline}"`));
  assert.ok(markup.includes(`<h1 id="landing-title">Easy Proto</h1><p>${tagline}</p>`));
  assert.match(
    markup,
    /<title\b[^>]*>Easy Proto \| Open-source prototyping and design tokens<\/title>/,
  );
  assert.match(markup, /<link rel="canonical" href="https:\/\/easyproto\.app\/"/);
  assert.match(markup, /<meta property="og:url" content="https:\/\/easyproto\.app\/"/);
  assert.match(markup, /"@type":"SoftwareApplication"/);
  assert.match(markup, /id="__NEXT_DATA__"/);
  for (const [, attributes] of markup.matchAll(/<script\b([^>]*)>/g))
    assert.match(attributes, /\bsrc="\/_next\/static\/|\btype="application\/(?:json|ld\+json)"/);
  const [, script] = markup.match(/src="(\/_next\/static\/[^"]+\.js)"/);
  const chunk = await call(production, script);
  assert.equal(chunk.status, 200);
  assert.match(chunk.headers.get("x-robots-tag"), /noindex/);

  const robots = await call(production, "/robots.txt");
  assert.equal(
    await robots.text(),
    "User-agent: *\nAllow: /\nSitemap: https://easyproto.app/sitemap.xml\n",
  );
  const sitemap = await call(production, "/sitemap.xml");
  assert.match(sitemap.headers.get("content-type"), /application\/xml/);
  assert.deepEqual(
    [...(await sitemap.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]),
    [production + "/"],
  );
  const alias = await call(production, "/index.html");
  assert.equal(alias.status, 308);
  assert.equal(alias.headers.get("location"), production + "/");
  assert.match(alias.headers.get("x-robots-tag"), /noindex/);
  assert.equal((await call(production, "/made-up-page")).status, 404);
  for (const origin of [production, staging]) {
    assert.equal((await call(origin, "/shared-preview.html")).status, 404);
    assert.equal((await call(origin, "/demo")).status, 404);
  }
  assert.match((await call(staging)).headers.get("x-robots-tag"), /noindex/);
  assert.equal((await call(staging, "/sitemap.xml")).status, 404);
  assert.equal((await call(production, "/sitemap.xml", { method: "HEAD" })).status, 200);
});

test("hosted shares protect metadata and resources, keep the link on sync, and rotate access", async (t) => {
  const { database, env, metadata, rawHtml, sync, token } = await fixture(t);
  const origin = "https://viewer.example.test";
  const artifacts = "https://artifacts.example.test";
  Object.assign(env, {
    VIEWER_ORIGIN: origin,
    ARTIFACT_ORIGIN: artifacts,
    SHARE_KEY: "k".repeat(43),
    HOSTED_PUBLISH_TOKEN: token,
  });
  const endpoint = origin + "/api/hosted/sync";
  const call = (url, options) => worker.fetch(new Request(url, options), env);
  assert.equal((await sync()).status, 404);
  assert.equal((await sync(metadata, { endpoint }, { origin })).status, 403);
  assert.equal(
    (await sync(metadata, { endpoint }, { authorization: "Bearer " + "z".repeat(43) })).status,
    403,
  );
  const tokens = Buffer.from(":root {\n  --ep-color-test: #123456;\n}\n");
  const document = Buffer.from(previewHtml(rawHtml, true));
  const manifest = {
    ...metadata.manifest,
    artboards: [
      { ...metadata.manifest.artboards[0], document: member(document), tokens: member(tokens) },
    ],
  };
  const publish = async (access, revision, requestId) => {
    const response = await sync(
      { ...metadata, manifest: { ...manifest, revision } },
      { endpoint, document, tokens, access, requestId },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const plain = await publish(undefined, 1);
  const url = origin + "/p/" + plain.id;
  const api = origin + "/api/previews/" + plain.id;
  const getJson = async (cookie) => (await call(api, { headers: cookie ? { cookie } : {} })).json();
  const publicView = await getJson();
  const publicShell = await call(url);
  assert.equal(publicShell.status, 200);
  assert.match(publicShell.headers.get("x-robots-tag"), /noindex/);
  const oldDocument = publicView.artboards[0].iframeUrl;
  assert.equal(new URL(oldDocument).origin, artifacts);
  assert.equal((await call(oldDocument)).status, 200);
  const requestId = randomUUID();
  const locked = await publish("protected", 2, requestId);
  assert.equal(locked.id, plain.id);
  assert.match(locked.password, /^[\w-]{22}$/);
  const reserved = database
    .prepare("SELECT reserved_bytes FROM hosted_storage_budget")
    .get().reserved_bytes;
  assert.deepEqual(await publish("protected", 2, requestId), locked);
  assert.equal(
    database.prepare("SELECT reserved_bytes FROM hosted_storage_budget").get().reserved_bytes,
    reserved,
  );
  assert.equal(
    (
      await sync(
        { ...metadata, manifest: { ...manifest, revision: 2 } },
        {
          endpoint,
          document,
          tokens,
          requestId,
          access: "public",
        },
      )
    ).status,
    409,
  );
  assert.equal((await call(oldDocument)).status, 404);
  assert.equal((await call(api + "/tokens")).status, 404);
  assert.deepEqual(await getJson(), { kind: "locked-preview", id: plain.id });
  const shell = await call(url);
  assert.match(shell.headers.get("cache-control"), /no-store/);
  assert.match(shell.headers.get("x-robots-tag"), /noindex/);
  assert.doesNotMatch(await shell.text(), /Notes|Concepts|rel="canonical"/);
  const unlock = (password, sender = origin, ip = "192.0.2.1") =>
    call(api + "/unlock", {
      method: "POST",
      headers: { origin: sender, "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ password }),
    });
  assert.equal((await unlock(locked.password, artifacts)).status, 404);
  assert.equal((await unlock("incorrect")).status, 401);
  const authorized = await unlock(locked.password);
  assert.equal(authorized.status, 204);
  const setCookie = authorized.headers.get("set-cookie");
  assert.match(setCookie, /Secure; HttpOnly; SameSite=Strict/);
  const cookie = setCookie.split(";")[0];
  const page = await getJson(cookie);
  const frame = page.artboards[0].iframeUrl;
  for (const resource of ["index.html", "board.css", "tokens.css", "assets/pixel.png"]) {
    const link = new URL(resource, frame);
    const res = await call(link);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /no-store/);
    assert.match(res.headers.get("x-robots-tag"), /noindex/);
    const head = await call(link, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("x-robots-tag"), /noindex/);
    assert.equal((await call(new URL(link.pathname, origin))).status, 404);
  }
  assert.equal(
    (await call(frame.replace(metadata.manifest.artboards[0].id, randomUUID()))).status,
    404,
  );
  assert.match(
    await (await call(origin + page.tokensUrl, { headers: { cookie } })).text(),
    /--ep-color-test/,
  );
  const sameAccess = await publish(undefined, 3);
  assert.equal(sameAccess.access, "protected");
  assert.equal((await getJson(cookie)).kind, "page-preview");
  const untilRotation = (await getJson(cookie)).artboards[0].iframeUrl;
  const rotated = await publish("protected", 4);
  assert.equal(rotated.id, plain.id);
  assert.notEqual(rotated.password, locked.password);
  assert.equal((await unlock(locked.password)).status, 401);
  assert.equal((await getJson(cookie)).kind, "locked-preview");
  assert.equal((await call(untilRotation)).status, 404);
  assert.equal((await unlock(rotated.password)).status, 204);
  assert.equal((await unlock(rotated.password)).status, 429);
  assert.equal((await unlock(rotated.password, origin, "192.0.2.2")).status, 204);
  assert.equal(
    database.prepare("SELECT hits FROM hosted_limits WHERE scope=?").get(`unlock:${plain.id}`).hits,
    5,
  );
  assert.ok(
    !database
      .prepare("SELECT verifier FROM hosted_shares")
      .get()
      .verifier.includes(rotated.password),
  );
  const different = await sync(
    { ...metadata, pageId: randomUUID() },
    { endpoint, access: "protected" },
  );
  assert.equal(different.status, 200);
  const other = await different.json();
  database.prepare("UPDATE hosted_limits SET hits=8 WHERE scope=?").run(`unlock:${plain.id}`);
  assert.equal((await unlock(rotated.password)).status, 429);
  assert.equal(
    (
      await call(origin + "/api/previews/" + other.id + "/unlock", {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: other.password }),
      })
    ).status,
    204,
  );
  const unlocked = await publish("public", 5);
  assert.equal(unlocked.access, "public");
  assert.equal((await getJson()).kind, "page-preview");
  database.prepare("UPDATE hosted_storage_budget SET reserved_bytes=262144000").run();
  assert.equal((await sync(metadata, { endpoint })).status, 507);
  database.prepare("UPDATE hosted_limits SET hits=10 WHERE scope='upload'").run();
  assert.equal((await sync(metadata, { endpoint })).status, 429);
});

test("waitlist normalizes and deduplicates emails and rejects invalid or cross-origin requests", async (t) => {
  const { database, env } = await fixture(t);
  const joinList = (email, origin = "http://127.0.0.1:8787", website = "") =>
    worker.fetch(
      new Request("http://127.0.0.1:8787/api/waitlist", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email, website }),
      }),
      env,
    );
  assert.equal((await joinList(" TEST@example.test ")).status, 200);
  assert.equal((await joinList("test@example.test")).status, 200);
  assert.deepEqual(
    database
      .prepare("SELECT email FROM waitlist")
      .all()
      .map(({ email }) => email),
    ["test@example.test"],
  );
  assert.equal((await joinList("invalid")).status, 400);
  assert.equal((await joinList("other@example.test", "https://elsewhere.test")).status, 403);
  assert.equal((await joinList("bot@example.test", undefined, "bot-filled-field")).status, 200);
  assert.equal(database.prepare("SELECT count(*) AS count FROM waitlist").get().count, 1);
});

async function browserPage(t, env, origin) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const response = await worker.fetch(
      new Request(request.url(), {
        method: request.method(),
        headers: await request.allHeaders(),
        body: request.postDataBuffer(),
      }),
      env,
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  return page;
}

test("the homepage keeps its first paint when JavaScript loads", async (t) => {
  const origin = "http://127.0.0.1:8787";
  const { env } = await fixture(t);
  const page = await browserPage(t, env, origin);
  await page.setViewportSize({ width: 390, height: 844 });
  const scriptReady = Promise.withResolvers();
  await page.route(/\/_next\/static\/.*\.js$/, async (route) => {
    await scriptReady.promise;
    await route.fallback();
  });

  try {
    await page.goto(origin, { waitUntil: "commit" });
    const heading = page.locator("#landing-title");
    const logo = page.getByTestId("edge-runner");
    await heading.waitFor();
    await logo.waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    assert.equal(await page.locator("form[inert]").count(), 1);
    const firstHeading = await heading.elementHandle();
    const firstLogo = await logo.elementHandle();
    const firstBox = await heading.boundingBox();
    assert.ok(firstBox.y > 100);
    assert.ok(Math.abs(firstBox.x + firstBox.width / 2 - 195) < 1);

    scriptReady.resolve();
    await page.locator("form:not([inert])").waitFor();
    assert.equal(await firstHeading.evaluate((element) => element.isConnected), true);
    assert.equal(await firstLogo.evaluate((element) => element.isConnected), true);
    assert.deepEqual(await heading.boundingBox(), firstBox);
  } finally {
    scriptReady.resolve();
  }
});

test("published boards show the Fold until the iframe loads and respect reduced motion", async (t) => {
  const origin = "http://127.0.0.1:8787";
  const { env, sync } = await fixture(t);
  const { id } = await (await sync()).json();
  const page = await browserPage(t, env, origin);
  const boardUrl = "**/preview-artifacts/**/index.html";

  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    const release = Promise.withResolvers();
    await page.route(boardUrl, async (route) => {
      await release.promise;
      await route.fallback();
    });

    try {
      await page.goto(`${origin}/p/${id}`, { waitUntil: "domcontentloaded" });
      const frame = page.locator("iframe");
      const loading = page.getByRole("status", { name: "Loading Home" });
      const highlight = loading.getByTestId("edge-runner-highlight");
      await highlight.waitFor();
      assert.equal(
        await highlight.evaluate((path) => path.getAnimations().length),
        reducedMotion === "reduce" ? 0 : 1,
      );
      assert.equal(await frame.evaluate((element) => getComputedStyle(element).opacity), "0");
      await frame.evaluate((element) => {
        element.addEventListener("transitionend", (event) => {
          if (event.propertyName === "opacity") element.dataset.fadeComplete = "true";
        });
      });

      release.resolve();
      await loading.waitFor({ state: "detached" });
      await page.frameLocator("iframe").getByRole("heading", { name: "Live board" }).waitFor();
      if (reducedMotion === "no-preference") {
        await page.locator('iframe[data-fade-complete="true"]').waitFor();
      } else {
        assert.equal(
          await frame.evaluate((element) => getComputedStyle(element).transitionDuration),
          "0s",
        );
      }
      assert.equal(await frame.evaluate((element) => getComputedStyle(element).opacity), "1");
    } finally {
      release.resolve();
      await page.unroute(boardUrl);
    }
  }
});

test("the web home and published page share the desktop header and the waitlist confirms signup", async (t) => {
  const origin = "http://127.0.0.1:8787";
  const { database, env, sync } = await fixture(t);
  const saved = await sync();
  assert.equal(saved.ok, true);
  const { id } = await saved.json();
  const page = await browserPage(t, env, origin);
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1180, 660]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 600 });
      await page.goto(`${origin}/p/${id}`);
      await page.frameLocator("iframe").getByRole("heading", { name: "Live board" }).waitFor();
      assert.equal(await page.title(), "Notes - Concepts");
      assert.equal(await page.getByTestId("workspace-project").innerText(), "Notes");
      assert.equal(await page.getByTestId("workspace-page").innerText(), "Concepts");
      await checkWorkspaceHeader(page, { dark: colorScheme === "dark", compact: width === 660 });
      const headerMetrics = () =>
        page.getByTestId("workspace-header").evaluate(async (header) => {
          await document.fonts.ready;
          const { height, paddingInlineStart, backgroundColor, color } = getComputedStyle(header);
          const brand = header.querySelector("[data-testid=brand]");
          return [
            height,
            paddingInlineStart,
            backgroundColor,
            color,
            getComputedStyle(brand).fontSize,
          ];
        });
      const previewHeader = await headerMetrics();
      await page.goto(origin);
      await page.getByRole("heading", { name: "Easy Proto", exact: true }).waitFor();
      assert.equal(await page.title(), "Easy Proto | Open-source prototyping and design tokens");
      assert.deepEqual(await headerMetrics(), previewHeader);
    }
  }
  assert.equal(await page.getByTestId("workspace-header").innerText(), "Easy Proto");
  assert.equal(await page.locator("footer").count(), 0);
  const heroMark = page.getByRole("main").getByTestId("edge-runner");
  const highlight = heroMark.getByTestId("edge-runner-highlight");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const timing = await highlight.evaluate((path) => {
    const [animation] = path.getAnimations();
    if (!animation?.effect) throw new Error("The homepage logo animation is missing.");
    const { duration, iterations } = animation.effect.getTiming();
    animation.currentTime = Number(duration) * 3.25;
    return [animation.playState, iterations, animation.effect.getComputedTiming().currentIteration];
  });
  assert.deepEqual(timing, ["running", Infinity, 3]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await highlight.evaluate((path) => path.getAnimations().length), 0);
  assert.equal(await heroMark.isVisible(), true);
  assert.equal(
    await page
      .getByText(
        "Easy Proto is a free, open-source tool that brings prototyping, design tokens, and component management into a single workspace.",
        { exact: true },
      )
      .isVisible(),
    true,
  );
  assert.equal(
    await page.getByRole("status").innerText(),
    "We’ll send you a message when Easy Proto is ready.",
  );
  const email = page.getByRole("textbox", { name: "Email address" });
  await email.fill("designer@example.com");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  const joined = page.getByRole("button", { name: "You’re on the list" });
  await joined.waitFor();
  assert.equal(await heroMark.isVisible(), true);
  assert.equal(await joined.isDisabled(), true);
  assert.equal(await email.isDisabled(), true);
  assert.match(await page.getByRole("status").innerText(), /Thanks\. We’ll be in touch/);
  assert.equal(database.prepare("SELECT email FROM waitlist").get().email, "designer@example.com");
});

test("a published page can search and copy its token formats without changing its artboard", async (t) => {
  const origin = "http://127.0.0.1:8787";
  const { env, metadata, rawHtml, sync } = await fixture(t);
  const file = Buffer.from(`:root {
  --ep-color-accent: #317460;
  --ep-color-link: var(--ep-color-accent);
  --ep-motion-fast: 160ms;
  --ep-spacing-card: 16px;
  --ep-unitless-count: 600;
  --ep-unitless-weight: 600;
  --ep-unitless-count-alias: var(--ep-unitless-count);
  --ep-unitless-weight-alias: var(--ep-unitless-weight);
}
`);
  const document = Buffer.from(previewHtml(rawHtml, true));
  const initial = await sync();
  assert.equal(initial.ok, true);
  const { id } = await initial.json();
  const page = await browserPage(t, env, origin);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(`${origin}/p/${id}`);
  const trigger = page.getByRole("button", { name: "Tokens", exact: true });
  const dialog = page.getByRole("dialog", { name: "Project tokens" });
  await trigger.click();
  await dialog.getByText("This preview has no project tokens.").waitFor();
  await dialog.getByRole("button", { name: "Close tokens" }).click();
  const [board] = metadata.manifest.artboards;
  const updated = await sync(
    {
      ...metadata,
      manifest: {
        ...metadata.manifest,
        revision: 2,
        artboards: [{ ...board, document: member(document), tokens: member(file) }],
      },
    },
    { document, tokens: file },
  );
  assert.equal(updated.ok, true);
  assert.equal((await updated.json()).id, id);

  await page.reload();
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Live board" }).waitFor();
  assert.ok(
    (
      await frame
        .locator("body")
        .evaluate((body) => getComputedStyle(body).getPropertyValue("--ep-color-accent"))
    ).includes("#317460"),
  );
  await page.route("**/tokens.css", (route) =>
    route.request().resourceType() === "fetch"
      ? route.fulfill({ status: 503, body: "Temporarily unavailable" })
      : route.fallback(),
  );
  await trigger.click();
  await dialog.getByRole("alert").waitFor();
  const retry = dialog.getByRole("button", { name: "Try again" });
  await page.keyboard.press("Tab");
  assert.equal(await retry.evaluate((button) => button.matches(":focus-visible")), true);
  await page.unroute("**/tokens.css");
  await page.keyboard.press("Enter");
  const search = dialog.getByRole("searchbox", { name: "Search tokens" });
  await search.waitFor();
  assert.equal(await dialog.evaluate((modal) => modal.contains(document.activeElement)), true);
  await search.fill("color-link");
  assert.equal(await dialog.getByRole("row").count(), 2);
  const overflow = dialog.getByRole("button", { name: "Copy options for color-link" });
  await overflow.press("Enter");
  const menu = dialog.getByRole("menu");
  const css = menu.getByRole("menuitem", { name: "Copy CSS variable" });
  await css.waitFor();
  await page.waitForFunction(() =>
    document.activeElement?.textContent.includes("Copy CSS variable"),
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await dialog.getByText("All formats copied.").waitFor();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clipboard, /var\(--ep-color-link\)/);
  assert.match(clipboard, /CSS value\n#317460/);
  assert.match(clipboard, /Color\(\.sRGB, red:/);
  assert.match(clipboard, /<color name="ep_color_link">#FF317460<\/color>/);
  assert.equal(await overflow.evaluate((element) => element === document.activeElement), true);
  await page.setViewportSize({ width: 390, height: 650 });
  await search.fill("spacing-card");
  for (const cell of [
    dialog.getByRole("columnheader", { name: "Actions" }),
    dialog.getByRole("cell", { name: "Dimension" }),
  ]) {
    assert.equal(
      await cell.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      }),
      1,
    );
  }
  await dialog.getByRole("button", { name: "Copy options for spacing-card" }).click();
  await menu.waitFor();
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390);
  assert.equal(await menu.getByRole("menuitem").count(), 3);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await dialog.isVisible(), true);
  await search.fill("unitless");
  assert.equal(await dialog.getByRole("cell", { name: "Unitless", exact: true }).count(), 4);
  await dialog.getByRole("button", { name: "Copy options for unitless-weight-alias" }).click();
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
    "Copy CSS variable",
    "Copy CSS value",
    "Copy all formats",
  ]);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await frame.getByRole("heading", { name: "Live board" }).waitFor();
});

test("token formats resolve aliases and keep native units accurate", () => {
  const [duration, color, alias, pixels, wholeMilliseconds, fractionalMilliseconds, unitless] =
    readSharedTokens(
      ":root {\n  --ep-fast: 0.16s;\n  --ep-color: rgba(49, 116, 96, 0.5);\n  --ep-link: var(--ep-color);\n  --ep-gap: 8px;\n  --ep-seconds: 1.001s;\n  --ep-fraction: 1.0001s;\n  --ep-weight: 600;\n}\n",
    );
  assert.equal(copyFormats(duration)[2].value, "Duration.seconds(0.16)");
  assert.equal(copyFormats(duration)[3].value, '<integer name="ep_fast">160</integer>');
  assert.equal(copyFormats(color)[3].value, '<color name="ep_color">#80317460</color>');
  assert.equal(alias.resolved, color.resolved);
  assert.equal(copyFormats(pixels).length, 2);
  assert.equal(
    copyFormats(wholeMilliseconds)[3].value,
    '<integer name="ep_seconds">1001</integer>',
  );
  assert.equal(copyFormats(fractionalMilliseconds).length, 3);
  assert.equal(copyFormats(unitless).length, 2);
  assert.throws(
    () => readSharedTokens(":root {\n  --ep-cycle: var(--ep-cycle);\n}\n"),
    /Invalid token alias/,
  );
});

test("page sync keeps one URL and serves immutable sandboxed HTML, CSS, and assets", async (t) => {
  const { database, env, metadata, image, sync } = await fixture(t);
  const first = await sync();
  assert.equal(first.status, 200);
  const saved = await first.json();
  const getView = () =>
    worker.fetch(
      new Request(`http://127.0.0.1:8787/p/${saved.id}`, {
        headers: { accept: "application/json" },
      }),
      env,
    );
  const view = await (await getView()).json();
  assert.equal(view.kind, "page-preview");
  assert.equal(view.artboards[0].x, -400);
  const shellResponse = await worker.fetch(new Request(`http://127.0.0.1:8787/p/${saved.id}`), env);
  const shell = await shellResponse.text();
  assert.match(shell, /<title\b[^>]*>Notes - Concepts<\/title>/);
  assert.match(shell, /id="page-data"/);
  for (const hidden of ["revision", metadata.projectId, metadata.pageId, "digest", "bytes"])
    assert.equal(JSON.stringify(view).includes(hidden), false);
  const documentUrl = new URL(view.artboards[0].iframeUrl, "http://127.0.0.1:8787");
  let response = await worker.fetch(new Request(documentUrl), env);
  const firstDocument = await response.text();
  assert.match(response.headers.get("content-security-policy"), /^sandbox;/);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.match(firstDocument, /Live board/);
  assert.doesNotMatch(firstDocument, /script|onclick|https:\/\/example\.test|iframe/i);
  response = await worker.fetch(new Request(new URL("./board.css", documentUrl)), env);
  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await response.text(), /rgb\(12,34,56\)/);
  response = await worker.fetch(new Request(new URL("./assets/pixel.png", documentUrl)), env);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  metadata.manifest.revision = 2;
  assert.equal((await (await sync()).json()).id, saved.id);
  const updated = await (await getView()).json();
  assert.notEqual(updated.artboards[0].iframeUrl, view.artboards[0].iframeUrl);
  assert.equal((await worker.fetch(new Request(documentUrl), env)).status, 200);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 1);
  metadata.manifest.revision = 1;
  assert.equal((await sync()).status, 409);
});

test("page sync rejects unsafe or mismatched members without exposing partial uploads", async (t) => {
  const { database, env, metadata, document, rawHtml, sync, objects, token } = await fixture(t);
  assert.equal((await sync(metadata, {}, { origin: "http://127.0.0.1:8787" })).status, 403);
  assert.equal(
    (await sync(metadata, {}, { authorization: "Bearer " + "y".repeat(43) })).status,
    403,
  );
  assert.equal((await sync(metadata, { image: png(200, 100) })).status, 400);
  assert.equal((await sync(metadata, { extra: true })).status, 400);
  const unsafe = Buffer.from(rawHtml);
  const unsafeMetadata = structuredClone(metadata);
  unsafeMetadata.manifest.artboards[0].document = member(unsafe);
  assert.equal((await sync(unsafeMetadata, { document: unsafe })).status, 400);
  assert.equal(database.prepare("SELECT count(*) AS count FROM page_previews").get().count, 0);
  assert.equal(objects.size, 0);
  env.PREVIEWS.put = async (key, bytes) => {
    objects.set(key, bytes);
    throw new Error("storage failed");
  };
  assert.equal((await sync(metadata, { document })).status, 500);
  assert.equal(objects.size, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM snapshots").get().count, 0);
  assert.equal(
    (
      await worker.fetch(
        new Request("https://example.test/api/local/page", {
          headers: { authorization: `Bearer ${token}` },
        }),
        env,
      )
    ).status,
    403,
  );
});

test("artifact routes reject undeclared boards, assets, traversal, and queries", async (t) => {
  const { env, sync } = await fixture(t);
  const { id } = await (await sync()).json();
  const missing = await worker.fetch(
    new Request(`http://127.0.0.1:8787/api/previews/${randomUUID()}`),
    env,
  );
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control"), /no-store/);
  const view = await (
    await worker.fetch(new Request(`http://127.0.0.1:8787/api/previews/${id}`), env)
  ).json();
  const documentUrl = new URL(view.artboards[0].iframeUrl, "http://127.0.0.1:8787");
  assert.equal(
    (await worker.fetch(new Request(new URL("./assets/private.png", documentUrl)), env)).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(documentUrl.href.replace(view.artboards[0].id, randomUUID())),
        env,
      )
    ).status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request(new URL("./assets/%252e%252e/private.png", documentUrl)), env))
      .status,
    404,
  );
  assert.equal((await worker.fetch(new Request(documentUrl.href + "?secret=1"), env)).status, 404);
  const shell = await worker.fetch(new Request(`http://127.0.0.1:8787/p/${id}`), env);
  assert.match(shell.headers.get("content-security-policy"), /frame-src 'self'/);
});

test("waitlist schema persists across local database reopening", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "easy-proto-waitlist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "local.sqlite");
  let database = new DatabaseSync(path);
  database.exec(
    await readFile(new URL("migrations/0001_page_previews.sql", import.meta.url), "utf8"),
  );
  database
    .prepare("INSERT INTO waitlist VALUES (?, ?)")
    .run("saved@example.test", new Date().toISOString());
  database.close();
  database = new DatabaseSync(path);
  assert.equal(database.prepare("SELECT email FROM waitlist").get().email, "saved@example.test");
  database.close();
});
