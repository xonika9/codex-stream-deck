import assert from "node:assert/strict";
import test from "node:test";
import { projectActiveQueue } from "../src/active-queue.js";
import { HostActivityIndex, type HostSnapshot } from "../src/relay-protocol.js";
import type { CodexHost, MicroSnapshot, RoutedAgentSlot } from "../src/types.js";

const mac: CodexHost = {
  hostId: "56fd97ad-7073-42cc-85ce-befa17546d7c", hostName: "Test Mac", platform: "darwin"
};
const windows: CodexHost = {
  hostId: "11111111-1111-4111-8111-111111111111", hostName: "Test Windows", platform: "win32"
};

function thread(id: number): string {
  return `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`;
}

function routed(
  sourceSlot: number,
  status: string,
  activityAt?: number,
  host = mac,
  threadKey = thread(sourceSlot + 1)
): RoutedAgentSlot {
  return {
    id: sourceSlot, sourceSlot, status, activityAt, host, threadKey,
    title: `Task ${sourceSlot}`, selected: false, observedAt: 10_000
  };
}

function snapshot(host: CodexHost, hostSessions: MicroSnapshot["hostSessions"] = []): HostSnapshot {
  return {
    host,
    observedAt: 10_000,
    snapshot: {
      slots: Array.from({ length: 6 }, (_, id) => ({
        id, threadKey: thread(id + 1), title: `Task ${id}`, status: "idle", selected: false
      })),
      layout: {
        version: 1,
        slots: {
          ACT06: { keycapId: "FAST" }, ACT07: { keycapId: "APPR" }, ACT08: { keycapId: "REJ" },
          ACT09: { keycapId: "SPLIT" }, ACT10_ACT11: { keycapId: "CODEX" }, ACT12: { keycapId: "CODEX" }
        },
        analogStick: { up: {}, right: {}, down: {}, left: {} }
      },
      agentSource: "recent",
      lightingAutoOff: "3-minutes",
      theme: "dark",
      hostSessions
    }
  };
}

test("active queue omits irrelevant states and compacts native slots two and five", () => {
  assert.deepEqual(projectActiveQueue([], []), []);
  const slots = [
    routed(0, "idle"), routed(1, "working", 100), routed(2, "off"),
    routed(3, "future-state"), routed(4, "thinking", 200), routed(5, "idle")
  ];

  const projected = projectActiveQueue(slots, [snapshot(mac)]);

  assert.deepEqual(projected.map((slot) => slot.id), [0, 1]);
  assert.deepEqual(projected.map((slot) => slot.sourceSlot), [4, 1]);
});

test("active queue remains an explicit projection and does not mutate native routing order", () => {
  const input = snapshot(mac);
  input.snapshot.slots[0]!.status = "idle";
  input.snapshot.slots[1]!.status = "working";
  input.snapshot.slots[4]!.status = "working";
  const merged = new HostActivityIndex().merge([input]);

  const projected = projectActiveQueue(merged, [input]);

  assert.deepEqual(merged.map((slot) => slot.id), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(merged.map((slot) => slot.sourceSlot), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(projected.map((slot) => slot.sourceSlot), [1, 4]);
});

test("active queue orders attention, completion, then working with group-specific recency", () => {
  const slots = [
    routed(0, "working", 400),
    routed(1, "completed", 200),
    routed(2, "error", 150),
    routed(3, "awaiting-response", 100),
    routed(4, "unread", 300),
    routed(5, "thinking", 500)
  ];

  const projected = projectActiveQueue(slots, [snapshot(mac)]);

  assert.deepEqual(projected.map((slot) => slot.sourceSlot), [3, 2, 1, 4, 5, 0]);
});

test("active queue uses owning host session activity for completion FIFO and working recency", () => {
  const completedLater = thread(21);
  const completedEarlier = thread(22);
  const workingOlder = thread(23);
  const workingNewer = thread(24);
  const slots = [
    routed(0, "complete", 10, windows, completedLater),
    routed(1, "complete", 900, mac, completedEarlier),
    routed(2, "working", 990, windows, workingOlder),
    routed(3, "working", 20, mac, workingNewer)
  ];
  const inputs = [
    snapshot(mac, [
      { threadId: completedEarlier, activityAt: 100, status: "complete" },
      { threadId: workingNewer, activityAt: 400, status: "working" }
    ]),
    snapshot(windows, [
      { threadId: completedLater, activityAt: 200, status: "complete" },
      { threadId: workingOlder, activityAt: 300, status: "working" }
    ])
  ];

  const projected = projectActiveQueue(slots, inputs);

  assert.deepEqual(projected.map((slot) => slot.threadKey), [
    completedEarlier, completedLater, workingNewer, workingOlder
  ]);
  assert.equal(projected[0]!.host.hostId, mac.hostId);
  assert.equal(projected[1]!.host.hostId, windows.hostId);
});

test("active queue puts trustworthy timestamps first and resolves stable ties", () => {
  const sameSlotA = routed(4, "working", undefined, mac, thread(42));
  const sameSlotB = routed(4, "working", Number.NaN, windows, thread(41));
  const slots = [
    sameSlotA,
    routed(5, "working", 250, mac, thread(43)),
    routed(2, "working", 0, mac, thread(44)),
    sameSlotB
  ];

  const first = projectActiveQueue(slots, [snapshot(mac), snapshot(windows)]);
  const second = projectActiveQueue(slots, [snapshot(mac), snapshot(windows)]);

  assert.deepEqual(first.map((slot) => slot.threadKey), [thread(43), thread(44), thread(41), thread(42)]);
  assert.deepEqual(second.map((slot) => slot.threadKey), first.map((slot) => slot.threadKey));
});

test("active queue caps at six and preserves routed command identity while replacing display ids", () => {
  const remoteKey = `local:${thread(61)}`;
  const four = [0, 1, 2, 3].map((id) => routed(id + 2, "working", id + 1));
  assert.deepEqual(projectActiveQueue(four, [snapshot(mac)]).map((slot) => slot.id), [0, 1, 2, 3]);

  const remote = routed(5, "error", 1, windows, remoteKey);
  const projected = projectActiveQueue([
    ...Array.from({ length: 5 }, (_, id) => routed(id, "working", id + 1)), remote
  ], [snapshot(mac), snapshot(windows)]);

  assert.equal(projected.length, 6);
  assert.equal(projected[0]!.id, 0);
  assert.equal(projected[0]!.host, windows);
  assert.equal(projected[0]!.sourceSlot, 5);
  assert.equal(projected[0]!.threadKey, remoteKey);
});

test("active queue does not retain completion after upstream routing stops reporting it", () => {
  const key = thread(71);
  const inputs = [snapshot(mac, [{ threadId: key, activityAt: 100, status: "complete" }])];

  assert.equal(projectActiveQueue([routed(0, "complete", 50, mac, key)], inputs).length, 1);
  assert.deepEqual(projectActiveQueue([routed(0, "idle", 50, mac, key)], inputs), []);
});

test("full active catalog assigns projected transport slots to tasks outside the native six", () => {
  const input = snapshot(mac);
  input.snapshot.activeCatalog = {
    complete: true,
    candidates: [
      { threadKey: thread(81), conversationId: thread(81), title: "Pinned", status: "working", selected: false, activityAt: 200, catalogIndex: 0 },
      { threadKey: thread(82), conversationId: thread(82), title: "Unpinned", status: "working", selected: false, activityAt: 300, catalogIndex: 9 }
    ]
  };

  const merged = new HostActivityIndex().mergeActiveCatalog([input]);
  const projected = projectActiveQueue(merged, [input]);

  assert.deepEqual(projected.map((slot) => slot.threadKey), [thread(82), thread(81)]);
  assert.deepEqual(projected.map((slot) => slot.sourceSlot), [0, 1]);
});

test("full active catalog preserves native transport slots after queue reordering", () => {
  const input = snapshot(mac);
  input.snapshot.activeCatalog = {
    complete: true,
    candidates: [
      { threadKey: thread(83), conversationId: thread(83), title: "Native five", status: "working", selected: false, activityAt: 200, catalogIndex: 0, nativeSlot: 4 },
      { threadKey: thread(84), conversationId: thread(84), title: "Native two", status: "working", selected: false, activityAt: 300, catalogIndex: 1, nativeSlot: 1 }
    ]
  };

  const merged = new HostActivityIndex().mergeActiveCatalog([input]);
  const projected = projectActiveQueue(merged, [input]);

  assert.deepEqual(projected.map((slot) => slot.threadKey), [thread(84), thread(83)]);
  assert.deepEqual(projected.map((slot) => slot.sourceSlot), [1, 4]);
});

test("full active catalog distinguishes unavailable fallback from authoritative empty", () => {
  const fallback = snapshot(mac);
  fallback.snapshot.slots[0]!.status = "working";
  assert.equal(new HostActivityIndex().mergeActiveCatalog([fallback]).length, 6);

  const empty = snapshot(mac);
  empty.snapshot.activeCatalog = { complete: true, candidates: [] };
  assert.deepEqual(new HostActivityIndex().mergeActiveCatalog([empty]), []);
});

test("full active catalog keeps temporary keys separate without trusted conversation ids", () => {
  const input = snapshot(mac);
  const suffix = "10000000-0000-4000-8000-000000000091";
  input.snapshot.activeCatalog = {
    complete: true,
    candidates: [
      { threadKey: `local:client-new-thread:${suffix}`, title: "A", status: "working", selected: false, catalogIndex: 0 },
      { threadKey: `remote:client-new-thread:${suffix}`, title: "B", status: "working", selected: false, catalogIndex: 1 }
    ]
  };
  assert.equal(new HostActivityIndex().mergeActiveCatalog([input]).length, 2);
});

test("full active catalog de-duplicates by trusted conversation id and routes the owner's exact key", () => {
  const conversationId = thread(92);
  const local = snapshot(mac);
  const remote = snapshot(windows);
  local.snapshot.activeCatalog = { complete: true, candidates: [{
    threadKey: `remote:${conversationId}`, conversationId, title: "Mirror", status: "idle",
    selected: false, catalogIndex: 4
  }] };
  remote.snapshot.activeCatalog = { complete: true, candidates: [{
    threadKey: `local:${conversationId}`, conversationId, title: "Owner", status: "working",
    selected: false, activityAt: 500, catalogIndex: 1, ownedByHost: true
  }] };
  remote.snapshot.hostSessions = [{ threadId: conversationId, activityAt: 500, status: "working" }];

  const merged = new HostActivityIndex().mergeActiveCatalog([local, remote], 1_000, mac.hostId);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.host.hostId, windows.hostId);
  assert.equal(merged[0]!.threadKey, `local:${conversationId}`);
  assert.equal(merged[0]!.status, "working");
});

test("full catalog never copies a candidate key onto a session owner that lacks it", () => {
  const conversationId = thread(93);
  const local = snapshot(mac);
  const remote = snapshot(windows);
  local.snapshot.activeCatalog = { complete: true, candidates: [{
    threadKey: `remote:${conversationId}`, conversationId, title: "Only dispatchable key",
    status: "working", selected: false, catalogIndex: 0
  }] };
  remote.snapshot.activeCatalog = { complete: true, candidates: [] };
  remote.snapshot.hostSessions = [{ threadId: conversationId, activityAt: 500, status: "working" }];

  const [merged] = new HostActivityIndex().mergeActiveCatalog([local, remote], 1_000, mac.hostId);
  assert.equal(merged!.host.hostId, mac.hostId);
  assert.equal(merged!.threadKey, `remote:${conversationId}`);
});

test("custom source keeps the fixed native six instead of pooling the full catalog", () => {
  const input = snapshot(mac);
  input.snapshot.agentSource = "custom";
  input.snapshot.activeCatalog = { complete: true, candidates: [{
    threadKey: thread(99), conversationId: thread(99), title: "Off six", status: "working",
    selected: false, catalogIndex: 10
  }] };
  assert.deepEqual(
    new HostActivityIndex().mergeActiveCatalog([input]).map((slot) => slot.threadKey),
    input.snapshot.slots.map((slot) => slot.threadKey)
  );
});
