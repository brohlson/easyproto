import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { startWeb } from "./demo/server.mjs";

function getCookie(response) {
  return response.headers.get("set-cookie").split(";")[0];
}

async function getMagicLink(origin) {
  const request = await fetch(`${origin}/auth/request`, {
    method: "POST",
    headers: { Origin: origin },
    redirect: "manual",
    body: new URLSearchParams({ email: "owner@example.test" }),
  });
  assert.equal(request.status, 303);
  const cookie = getCookie(request);
  const inbox = await fetch(`${origin}/dev/inbox`, { headers: { Cookie: cookie } });
  const [, token] = /auth\/continue#([\w-]{43})/.exec(await inbox.text());
  return { cookie, token };
}

test("magic link is bound to its browser, survives GET and has one concurrent redemption", async (t) => {
  const app = await startWeb(0);
  t.after(app.close);
  const { origin } = app;
  const { cookie, token } = await getMagicLink(origin);
  const get = await fetch(`${origin}/auth/continue`);
  assert.equal(get.status, 200);
  const anonInbox = await fetch(`${origin}/dev/inbox`);
  assert.doesNotMatch(await anonInbox.text(), /auth\/continue#/);

  function redeem(initiator, browser) {
    return fetch(`${origin}/auth/continue`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: initiator, Cookie: browser },
      body: new URLSearchParams({ secret: token }),
    });
  }
  assert.equal((await redeem("https://example.test", cookie)).status, 403);
  assert.equal((await redeem(origin, "")).status, 401);
  const attempts = await Promise.all([redeem(origin, cookie), redeem(origin, cookie)]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [303, 401]);
  const ownerCookie = getCookie(attempts.find((response) => response.status === 303));
  const publisher = await fetch(`${origin}/publish`, { headers: { Cookie: ownerCookie } });
  assert.equal(publisher.status, 200);
  assert.match(publisher.headers.get("cache-control"), /no-store/);
  assert.equal((await fetch(`${origin}/publish`)).status, 401);
});

async function showBoard(page, url, expected, frame = null) {
  await page.goto(url);
  await page.waitForFunction(() => location.hash === "");
  await page.getByRole("button", { name: "Open preview" }).click();
  const artboards = page.locator("iframe");
  await artboards.first().waitFor();
  assert.equal(await artboards.count(), expected.length);
  for (const [name, heading, width, height] of expected) {
    const fixture = page.frameLocator(`iframe[title="${name}"]`);
    await fixture.getByRole("heading", { name: heading }).waitFor();
    assert.deepEqual(
      await fixture.locator("html").evaluate(() => [innerWidth, innerHeight, self.origin]),
      [width, height, "null"],
    );
  }
  if (frame) assert.equal(await page.locator(`.device.${frame}`).count(), 1);
}

async function publish(page, origin, scope, frame) {
  await page.goto(`${origin}/publish`);
  await page.getByLabel("Share", { exact: true }).selectOption(scope);
  await page.getByLabel("Device frame").selectOption(frame);
  await page.getByRole("button", { name: "Create share link" }).click();
  return page.getByLabel("Read-only preview link").inputValue();
}

test("Chromium owner publishes scoped canvas and framed artboards and revokes a loaded link", async (t) => {
  const app = await startWeb(0);
  t.after(app.close);
  const { origin } = app;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const owner = await browser.newPage();
  owner.setDefaultTimeout(5000);
  await owner.goto(origin + "/demo");
  const mark = owner.locator("svg.ep-fold-mark path");
  await mark.waitFor();
  const icon = await owner.locator('link[rel="icon"]').getAttribute("href");
  const iconSvg = await (await owner.request.get(origin + icon)).text();
  assert.equal(/<path[^>]*\bd="([^"]+)"/.exec(iconSvg)?.[1], await mark.getAttribute("d"));
  await owner.getByRole("textbox", { name: "Email" }).fill("owner@example.test");
  await owner.getByRole("button", { name: "Request sign-in link" }).click();
  await owner.getByRole("link", { name: "Open sign-in link" }).click();
  await owner.waitForFunction(() => location.hash === "");
  await owner.getByRole("button", { name: "Continue sign-in" }).click();
  await owner.getByRole("heading", { name: "Share Field Notes" }).waitFor();

  const overview = ["Overview", "Good morning, Sam.", 1120, 630];
  const today = ["Today", "Today", 390, 844];
  const canvasLink = await publish(owner, origin, "canvas", "none");
  const canvasPath = new URL(canvasLink).pathname;
  const guest = await browser.newPage({
    colorScheme: "light",
    viewport: { width: 1360, height: 960 },
  });
  guest.setDefaultTimeout(5000);
  await showBoard(guest, canvasLink, [overview, today]);
  assert.doesNotMatch(await guest.locator("header").innerText(), /Revision/);
  const originalWidth = (await guest.locator("iframe[title=Overview]").boundingBox()).width;
  await guest.getByRole("button", { name: "Zoom in" }).click();
  assert.ok((await guest.locator("iframe[title=Overview]").boundingBox()).width > originalWidth);
  assert.equal(
    await guest
      .frameLocator("iframe[title=Overview]")
      .locator("html")
      .evaluate(() => innerWidth),
    1120,
  );
  await guest.getByRole("button", { name: "Fit" }).click();
  const beforePan = await guest.locator(".camera").evaluate((camera) => camera.style.transform);
  await guest.mouse.move(40, 120);
  await guest.mouse.down();
  await guest.mouse.move(100, 180);
  await guest.mouse.up();
  const afterPan = await guest.locator(".camera").evaluate((camera) => camera.style.transform);
  assert.notEqual(afterPan, beforePan);
  await guest.getByRole("button", { name: "Fit" }).click();
  if (process.env.EASY_PROTO_WEB_EVIDENCE) {
    await guest.screenshot({ path: `${process.env.EASY_PROTO_WEB_EVIDENCE}/canvas.png` });
  }

  const phoneLink = await publish(owner, origin, "today", "phone");
  const phonePath = new URL(phoneLink).pathname;
  const phoneGuest = await browser.newPage({
    colorScheme: "dark",
    viewport: { width: 900, height: 920 },
  });
  phoneGuest.setDefaultTimeout(5000);
  await showBoard(phoneGuest, phoneLink, [today], "phone");
  if (process.env.EASY_PROTO_WEB_EVIDENCE) {
    await phoneGuest.screenshot({ path: `${process.env.EASY_PROTO_WEB_EVIDENCE}/phone.png` });
  }
  const protectedAsset = await phoneGuest.request.get(`${origin}${phonePath}/boards/today`);
  assert.equal(protectedAsset.status(), 200);
  assert.match(protectedAsset.headers()["content-security-policy"], /sandbox; default-src 'none'/);
  assert.match(protectedAsset.headers()["cache-control"], /no-store/);
  assert.equal(
    (await phoneGuest.request.get(`${origin}${phonePath}/boards/overview`)).status(),
    404,
  );
  assert.equal((await fetch(`${origin}${canvasPath}/boards/today`)).status, 404);
  const laptopLink = await publish(owner, origin, "overview", "laptop");
  await showBoard(guest, laptopLink, [overview], "laptop");
  if (process.env.EASY_PROTO_WEB_EVIDENCE) {
    await guest.screenshot({ path: `${process.env.EASY_PROTO_WEB_EVIDENCE}/laptop.png` });
  }

  await owner.getByRole("link", { name: "Manage links", exact: true }).click();
  await owner
    .getByRole("listitem")
    .filter({ hasText: "Today artboard" })
    .getByRole("button", { name: "Revoke" })
    .click();
  assert.equal((await phoneGuest.request.get(`${origin}${phonePath}`)).status(), 404);
  assert.equal((await phoneGuest.request.get(`${origin}${phonePath}/boards/today`)).status(), 404);
  assert.equal((await guest.request.get(`${origin}${canvasPath}/boards/today`)).status(), 200);
});
