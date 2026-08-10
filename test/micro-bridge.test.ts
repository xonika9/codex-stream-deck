import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  buildEnsureThreadActivatedExpression, canonicalThreadId, CodexMicroRendererBridge, nativeActionKey, REASONING_ENCODER_KEYS, resolveAgentDispatch,
  retainEvaluationPromise, selectCodexMainTarget, selectSidebarThreadId, threadKeysEquivalent
} from "../src/codex-micro-renderer-bridge.js";
import { ADDITIONAL_KEYCAPS, OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";
import { visualStatusFromMicro } from "../src/status.js";
import type { MicroSnapshot } from "../src/types.js";

test("official Micro statuses map to the Stream Deck color states", () => {
  assert.equal(visualStatusFromMicro("off"), "empty");
  assert.equal(visualStatusFromMicro("working"), "thinking");
  assert.equal(visualStatusFromMicro("thinking"), "thinking");
  assert.equal(visualStatusFromMicro("unread"), "complete");
  assert.equal(visualStatusFromMicro("done"), "complete");
  assert.equal(visualStatusFromMicro("approval"), "input");
  assert.equal(visualStatusFromMicro("awaiting-approval"), "input");
  assert.equal(visualStatusFromMicro("awaiting-response"), "input");
  assert.equal(visualStatusFromMicro("error"), "error");
  assert.equal(visualStatusFromMicro("idle"), "idle");
});

test("official keycap SVG contents are not bundled in the public source", async () => {
  const controller = await readFile(new URL("../src/controller.ts", import.meta.url), "utf8");
  assert.match(controller, /codexDeckStateRoot\(\)[\s\S]*icons/);
  assert.doesNotMatch(controller, /static\/imgs\/official/);
});

test("renderer bridge uses native Micro events and discovers hashed modules at runtime", async () => {
  const source = await readFile(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  for (const eventName of ["codex-micro-device-state-changed", "codex-micro-hid-event", "codex-micro-joystick-event"]) {
    assert.match(source, new RegExp(eventName));
  }
  assert.match(source, /link\[href\], script\[src\]/);
  assert.match(source, /performance\.getEntriesByType\('resource'\)/);
  assert.match(source, /createSubscriberAtom/);
  assert.match(source, /slots\.length === 6/);
  assert.match(source, /codex-micro-agent-source/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /activeThreadKey/);
  assert.match(source, /data-above-composer-conversation-id/);
  assert.match(source, /data-app-action-sidebar-thread-active/);
  assert.match(source, /directSettingReader/);
  assert.match(source, /get-setting/);
  assert.match(source, /found\.node\.store\.get\.bind\(found\.node\.store\)/);
  assert.doesNotMatch(source, /candidate\?\.token === appScope/);
  assert.doesNotMatch(source, /D90_rd6W|SFcKxWqG|DJFcGyy5/);
});

test("renderer bridge prefers the main index document over macOS avatar surfaces", () => {
  const target = selectCodexMainTarget([
    { type: "page", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://route" },
    { type: "page", url: "app://-/avatar-overlay-composition-surface.html?surfaceId=mascot-badge", webSocketDebuggerUrl: "ws://mascot" },
    { type: "page", url: "app://-/avatar-overlay-composition-surface.html?surfaceId=activity-slot-0", webSocketDebuggerUrl: "ws://slot" },
    { type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" }
  ]);

  assert.equal(target?.webSocketDebuggerUrl, "ws://main");
});

test("renderer bridge rejects auxiliary-only renderer lists", () => {
  const target = selectCodexMainTarget([
    { type: "page", url: "app://-/avatar-overlay-composition-surface.html?surfaceId=mascot-badge", webSocketDebuggerUrl: "ws://mascot" }
  ]);

  assert.equal(target, undefined);
});

test("renderer evaluations retain their awaited promise until CDP has collected the result", () => {
  const expression = retainEvaluationPromise("(async () => true)()", 17);
  assert.match(expression, /__codexDeckPendingEvaluations/);
  assert.match(expression, /codex-deck-17/);
  assert.match(expression, /Promise\.resolve/);
  assert.match(expression, /setTimeout\(\(\) => store\.delete/);
  const namespaced = retainEvaluationPromise("Promise.resolve(true)", "bridge-a-1");
  assert.match(namespaced, /codex-deck-bridge-a-1/);
});

test("renderer thread comparisons accept bare IDs without conflating host-prefixed mirrors", () => {
  const threadId = "019fc4e4-4ecc-7f20-b7f5-855c11da7b37";
  const local = `local:${threadId}`;
  const remote = `remote-ssh-codex-managed:mlgpu:${threadId}`;

  assert.equal(canonicalThreadId(threadId), threadId);
  assert.equal(canonicalThreadId(local), threadId);
  assert.equal(canonicalThreadId(remote), threadId);
  assert.equal(threadKeysEquivalent(local, threadId), true);
  assert.equal(threadKeysEquivalent(remote, threadId), true);
  assert.equal(threadKeysEquivalent(local, remote), false);
  assert.equal(selectSidebarThreadId(local, [threadId]), threadId);
  assert.equal(selectSidebarThreadId(remote, [local, remote]), remote);
  assert.equal(selectSidebarThreadId(threadId, [local]), local);
  assert.equal(selectSidebarThreadId(threadId, [local, remote]), undefined);
});

async function evaluateThreadActivation(
  threadKey: string,
  sidebarThreadIds: string[],
  activeSidebarThreadId: string | null,
  composerThreadId: string | null
): Promise<unknown> {
  const element = (id: string) => ({
    getAttribute: (name: string) => name === "data-app-action-sidebar-thread-id" || name === "data-above-composer-conversation-id" ? id : null,
    matches: () => false,
    querySelector: () => null,
    closest: () => null,
    click: () => {}
  });
  const sidebarElements = sidebarThreadIds.map(element);
  let now = 0;
  return runInNewContext(buildEnsureThreadActivatedExpression(threadKey), {
    Date: { now: () => now },
    document: {
      querySelector: (selector: string) => {
        if (selector.includes('data-app-action-sidebar-thread-active="true"')) {
          return activeSidebarThreadId ? element(activeSidebarThreadId) : null;
        }
        if (selector.includes('aria-current="page"')) return null;
        if (selector.includes("data-above-composer-conversation-id")) {
          return composerThreadId ? element(composerThreadId) : null;
        }
        return null;
      },
      querySelectorAll: () => sidebarElements
    },
    setTimeout: (callback: () => void, duration: number) => {
      now += duration;
      queueMicrotask(callback);
    }
  }) as Promise<unknown>;
}

test("thread activation evaluator preserves host identity across sidebar and composer state", async () => {
  const threadId = "019fc4e4-4ecc-7f20-b7f5-855c11da7b37";
  const local = `local:${threadId}`;
  const remote = `remote:${threadId}`;

  assert.equal(await evaluateThreadActivation(threadId, [local, remote], null, threadId), "missing");
  assert.equal(await evaluateThreadActivation(local, [local, remote], null, threadId), "failed");
  assert.equal(await evaluateThreadActivation(local, [local, remote], local, threadId), "active");
  assert.equal(await evaluateThreadActivation(threadId, [local], null, threadId), "active");
  assert.equal(await evaluateThreadActivation(local, [], null, local), "active");
});

test("native action 5 maps the combined layout slot to Codex push-to-talk", () => {
  assert.equal(nativeActionKey("ACT10_ACT11"), "ACT10");
  assert.equal(nativeActionKey("ACT06"), "ACT06");
});

test("remote MIC keycaps use the native push-to-talk press/release sequence", async () => {
  const bridge = new CodexMicroRendererBridge(() => {});
  const actions: Array<Parameters<CodexMicroRendererBridge["sendAction"]>> = [];
  bridge.sendAction = async (...args) => { actions.push(args); };

  await bridge.runKeycap("MIC");
  assert.deepEqual(actions, [
    ["ACT10_ACT11", 1],
    ["ACT10_ACT11", 0]
  ]);
});

test("agent routing follows the stable thread identity when a cross-host slot is stale", () => {
  const snapshot = {
    slots: Array.from({ length: 6 }, (_, id) => ({
      id,
      threadKey: `local:00000000-0000-4000-8000-00000000000${id}`,
      title: `Task ${id}`,
      status: "idle",
      selected: false
    })),
    layout: {
      version: 1,
      slots: {
        ACT06: { keycapId: "FAST" }, ACT07: { keycapId: "APPR" },
        ACT08: { keycapId: "REJ" }, ACT09: { keycapId: "SPLIT" },
        ACT10_ACT11: { keycapId: "CODEX" }, ACT12: { keycapId: "CODEX" }
      },
      analogStick: { up: {}, right: {}, down: {}, left: {} }
    },
    agentSource: "priority",
    lightingAutoOff: "3-minutes",
    theme: "dark"
  } as MicroSnapshot;
  const movedThread = snapshot.slots[4]!.threadKey!;
  assert.deepEqual(resolveAgentDispatch(snapshot, 2, movedThread), {
    kind: "native", slot: 4, threadKey: movedThread
  });
  const offDeckThread = "local:10000000-0000-4000-8000-000000000099";
  assert.deepEqual(resolveAgentDispatch(snapshot, 2, offDeckThread), {
    kind: "direct", threadKey: offDeckThread
  });
});

test("reasoning controls use the official native encoder rotation events", async () => {
  assert.deepEqual(REASONING_ENCODER_KEYS, {
    decrease: "ENC_CW",
    increase: "ENC_CC"
  });
  const source = await readFile(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  assert.match(source, /act: 2/);
  assert.match(source, /codex-micro-hid-event/);
});

test("manifest exposes both dedicated reasoning adjustment buttons", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as { Actions: Array<{ UUID: string }>; OS: Array<{ Platform: string }> };
  const actions = new Set(manifest.Actions.map((action) => action.UUID));
  assert.equal(actions.has("com.xonika9.codex-deck.reasoning-down"), true);
  assert.equal(actions.has("com.xonika9.codex-deck.reasoning-up"), true);
  assert.equal(actions.has("com.xonika9.codex-deck.host-toggle"), true);
  assert.deepEqual(manifest.OS.map(({ Platform }) => Platform).sort(), ["mac", "windows"]);
});

test("all official keycaps are covered by standalone or native actions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../static/manifest.json", import.meta.url), "utf8")) as { Actions: Array<{ UUID: string }> };
  const actions = new Set(manifest.Actions.map((action) => action.UUID));
  for (const keycap of ADDITIONAL_KEYCAPS) {
    assert.equal(actions.has(`com.xonika9.codex-deck.keycap-${keycap.slug}`), true, `missing ${keycap.id}`);
  }
  assert.equal(OFFICIAL_KEYCAP_IDS.length, 30);
  assert.equal(new Set(ADDITIONAL_KEYCAPS.map((keycap) => keycap.id)).size, 29);
  assert.equal(actions.has("com.xonika9.codex-deck.dictation"), true, "MIC uses the native press/release action");
});

test("standalone keycaps resolve Codex's live registry instead of hardcoding commands", async () => {
  const source = await readFile(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  assert.match(source, /codex-micro-layout-/);
  assert.match(source, /keycapGetter/);
  assert.match(source, /codex-micro-bridge-/);
  assert.match(source, /runnerLocal/);
  assert.match(source, /\\\\w/);
  assert.match(source, /import\\\\s/);
  assert.match(source, /codex_micro_hid/);
});

test("controller avoids overlapping polls and redundant image writes", async () => {
  const [source, targetSource] = await Promise.all([
    readFile(new URL("../src/controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/control-target.ts", import.meta.url), "utf8")
  ]);
  assert.match(source, /lastImages/);
  assert.match(source, /this\.lastImages\.get\(action\.id\) === image/);
  assert.match(source, /scheduleRefresh/);
  assert.match(source, /status === "thinking" \|\| status === "input"/);
  assert.match(source, /pressedAgents/);
  assert.match(source, /pressedControlTargets/);
  assert.match(source, /mobileSnapshotDirty/);
  assert.match(source, /runAndInvalidate/);
  assert.doesNotMatch(source, /const runAndRefresh/);
  assert.doesNotMatch(source, /if \(act === 1\) await this\.refresh\(\)/);
  assert.match(targetSource, /control-target\.json/);
  assert.match(source, /targetPlatform === "darwin"/);
  assert.doesNotMatch(source, /setInterval\(/);
});

test("assigned titleless threads use a new-chat label instead of Not assigned", async () => {
  const source = await readFile(new URL("../src/controller.ts", import.meta.url), "utf8");
  assert.match(source, /agent\?\.threadKey\s*&&\s*health\.state\s*===\s*"ready"\s*\?\s*"New chat"/);
  assert.match(source, /:\s*"Not assigned"/);
});
