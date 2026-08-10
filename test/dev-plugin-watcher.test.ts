import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The development watcher is intentionally a plain ESM script.
import { normalizeWatchEventPath, shouldRebuildWatchEvent } from "../scripts/dev-plugin.mjs";

const cwd = "/workspace";

test("dev watcher ignores generated icons with POSIX and Windows separators", () => {
  for (const filename of ["imgs/plugin-icon.png", "imgs\\plugin-icon.png"]) {
    assert.equal(normalizeWatchEventPath("static", filename, cwd), "static/imgs/plugin-icon.png");
    assert.equal(shouldRebuildWatchEvent("static", filename, cwd), false);
  }
});

test("dev watcher rebuilds for non-generated files", () => {
  assert.equal(shouldRebuildWatchEvent("src", "plugin.ts", cwd), true);
  assert.equal(shouldRebuildWatchEvent("static", "manifest.json", cwd), true);
});
