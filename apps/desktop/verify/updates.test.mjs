import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

test("the Mac updater offers Later and installs only after the restart callback", async (t) => {
  const resources = await mkdtemp(join(tmpdir(), "easy-proto-update-test-"));
  t.after(() => rm(resources, { recursive: true, force: true }));

  const updater = new EventEmitter();
  let installs = 0;
  let feed;
  updater.setFeedURL = (value) => {
    feed = value;
  };
  updater.quitAndInstall = () => {
    installs++;
  };
  let choice = 1;
  let prompt;
  globalThis.updateElectron = {
    app: { isPackaged: true, getVersion: () => "0.1.0" },
    autoUpdater: updater,
    dialog: {
      showMessageBox: async (_window, options) => {
        prompt = options;
        return { response: choice };
      },
    },
  };
  t.after(() => {
    delete globalThis.updateElectron;
  });
  const original = new Map();
  for (const [key, value] of Object.entries({
    resourcesPath: resources,
    platform: "darwin",
    arch: "arm64",
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(process, key));
    Object.defineProperty(process, key, { configurable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(process, key, descriptor);
      else delete process[key];
    }
  });
  const source = new URL("../src/main/app/updates.ts", import.meta.url).href;
  const mock =
    "data:text/javascript,export const {app,autoUpdater,dialog} = globalThis.updateElectron;";
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "electron" && context.parentURL === source)
        return { url: mock, shortCircuit: true };
      return next(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  const { startUpdates } = await import(source);

  function open(profile, restart, onError = () => assert.fail("Unexpected update error")) {
    const window = new EventEmitter();
    window.isDestroyed = () => false;
    startUpdates(window, profile, restart, onError);
    t.after(() => window.emit("closed"));
    return window;
  }
  open(undefined, () => assert.fail("Local packages should not install updates"));
  assert.equal(feed, undefined);
  await writeFile(join(resources, "easy-proto-release"), "");
  open("test-profile", () => assert.fail("Test profiles should not install updates"));
  assert.equal(feed, undefined);

  const later = open(undefined, () => assert.fail("Later must leave the app running"));
  assert.match(feed.url, /\/brohlson\/easyproto\/darwin-arm64\/0\.1\.0$/);
  updater.emit("update-downloaded");
  await setImmediate();
  assert.deepEqual(prompt.buttons, ["Restart to Update", "Later"]);
  assert.equal(prompt.defaultId, 1);
  assert.equal(prompt.cancelId, 1);
  assert.equal(installs, 0);
  later.emit("closed");
  updater.removeAllListeners();

  choice = 0;
  const saved = Promise.withResolvers();
  open(undefined, async (install) => {
    await saved.promise;
    install();
  });
  updater.emit("update-downloaded");
  await setImmediate();
  assert.equal(installs, 0);
  saved.resolve();
  await setImmediate();
  assert.equal(installs, 1);

  updater.removeAllListeners();
  let recovered = false;
  open(
    undefined,
    async () => {
      throw new Error("Installation failed");
    },
    () => {
      recovered = true;
    },
  );
  updater.emit("update-downloaded");
  await setImmediate();
  assert.equal(recovered, true);
  assert.equal(prompt.message, "Easy Proto couldn’t install the update");
});
