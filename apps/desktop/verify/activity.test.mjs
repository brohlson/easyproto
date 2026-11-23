import assert from "node:assert/strict";
import { test } from "node:test";
import { ArtboardActivity } from "../dist/activity.js";

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const lifetime = new AbortController();
  let changes = 0;
  const activity = new ArtboardActivity(lifetime.signal, () => changes++);
  t.after(() => lifetime.abort());
  return { activity, lifetime, changes: () => changes };
}

test("activity presentation holds quick work without delaying completion or repeating focus", (t) => {
  const { activity } = fixture(t);
  const finish = activity.begin(["a", "b"]);
  const first = activity.focus;
  assert.deepEqual(first, { sequence: 1, artboardIds: ["a", "b"] });
  finish();
  assert.equal(activity.isWorking("a"), false);
  assert.equal(activity.isPresenting("a"), true);
  t.mock.timers.tick(400);
  activity.begin(["a"])();
  assert.equal(activity.focus, first);
  t.mock.timers.tick(799);
  assert.equal(activity.isPresenting("a"), true);
  t.mock.timers.tick(1);
  assert.equal(activity.isPresenting("a"), false);
  assert.equal(activity.isPresenting("b"), false);
  activity.begin(["a"])();
  assert.equal(activity.focus.sequence, 2);
});

test("activity presentation respects overlapping leases, running work, and expiry", (t) => {
  const { activity } = fixture(t);
  assert.equal(activity.set("a", "one", true), true);
  const first = activity.focus;
  t.mock.timers.tick(500);
  activity.set("a", "one", true);
  activity.set("a", "two", true);
  const finish = activity.begin(["a"]);
  assert.equal(activity.focus, first);
  activity.set("a", "one", false);
  activity.set("a", "two", false);
  t.mock.timers.tick(2000);
  assert.equal(activity.isPresenting("a"), true);
  finish();
  assert.equal(activity.isWorking("a"), false);
  assert.equal(activity.isPresenting("a"), false);
  activity.set("a", "abandoned", true);
  t.mock.timers.tick(120_000);
  assert.equal(activity.isWorking("a"), false);
  assert.equal(activity.isPresenting("a"), false);
});

test("activity presentation cleans failed work, deleted boards, and retired projects", async (t) => {
  const { activity, lifetime, changes } = fixture(t);
  await assert.rejects(
    activity.run("a", async () => {
      throw new Error("save failed");
    }),
  );
  assert.equal(activity.isWorking("a"), false);
  assert.equal(activity.isPresenting("a"), true);
  activity.pruneLeases(() => false);
  assert.equal(activity.isPresenting("a"), false);
  t.mock.timers.tick(2000);
  activity.begin(["b"])();
  const count = changes();
  lifetime.abort();
  t.mock.timers.tick(120_000);
  assert.equal(changes(), count);
  assert.equal(activity.isPresenting("b"), false);
  assert.equal(activity.focus, undefined);
  activity.begin(["retired"])();
  assert.equal(activity.set("retired", "late", true), false);
  assert.equal(activity.isWorking("retired"), false);
  assert.equal(activity.isPresenting("retired"), false);
});
