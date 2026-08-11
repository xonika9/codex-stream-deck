import { threadIdentity, validTimestamp, type HostSnapshot } from "./relay-protocol.js";
import type { RoutedAgentSlot } from "./types.js";

type QueueCandidate = {
  slot: RoutedAgentSlot;
  group: number;
  activityAt: number | null;
  identity: string;
};

const ATTENTION_STATUSES = new Set(["approval", "awaiting-approval", "awaiting-response", "error"]);
const COMPLETION_STATUSES = new Set(["unread", "complete", "completed", "done"]);
const WORKING_STATUSES = new Set(["working", "thinking"]);

/**
 * Filters and ranks slots after host routing has resolved ownership and mirrors.
 * The returned ids are display positions; host/sourceSlot/threadKey still identify
 * the routed command target.
 */
export function projectActiveQueue(
  routedSlots: readonly RoutedAgentSlot[],
  inputs: readonly HostSnapshot[]
): RoutedAgentSlot[] {
  const sessionsByHost = new Map(inputs.map((input) => [input.host.hostId, input.snapshot.hostSessions ?? []]));

  return routedSlots
    .flatMap((slot): QueueCandidate[] => {
      if (!slot.threadKey) return [];
      const group = queueGroup(slot.status);
      if (group == null) return [];
      const identity = threadIdentity(slot.threadKey);
      const sessionActivity = group === 0
        ? null
        : newestMatchingSessionActivity(sessionsByHost.get(slot.host.hostId), identity);
      return [{
        slot,
        group,
        activityAt: sessionActivity ?? validTimestamp(slot.activityAt),
        identity
      }];
    })
    .sort(compareCandidates)
    .slice(0, 6)
    .map(({ slot }, id) => ({
      ...slot,
      id,
      sourceSlot: slot.catalogIndex != null && slot.nativeSlot == null ? id : slot.sourceSlot
    }));
}

function queueGroup(status: string): number | null {
  if (ATTENTION_STATUSES.has(status)) return 0;
  if (COMPLETION_STATUSES.has(status)) return 1;
  if (WORKING_STATUSES.has(status)) return 2;
  return null;
}

function compareCandidates(left: QueueCandidate, right: QueueCandidate): number {
  if (left.group !== right.group) return left.group - right.group;
  if (left.activityAt == null || right.activityAt == null) {
    if (left.activityAt != null) return -1;
    if (right.activityAt != null) return 1;
  } else if (left.activityAt !== right.activityAt) {
    return left.group === 2
      ? right.activityAt - left.activityAt
      : left.activityAt - right.activityAt;
  }
  return (left.slot.catalogIndex ?? left.slot.sourceSlot) - (right.slot.catalogIndex ?? right.slot.sourceSlot) ||
    left.slot.sourceSlot - right.slot.sourceSlot ||
    compareText(left.identity, right.identity) ||
    compareText(left.slot.host.hostId, right.slot.host.hostId);
}

function newestMatchingSessionActivity(
  sessions: readonly { threadId: string; activityAt: number }[] | undefined,
  identity: string
): number | null {
  let newest: number | null = null;
  for (const session of sessions ?? []) {
    const activityAt = validTimestamp(session.activityAt);
    if (threadIdentity(session.threadId) === identity && activityAt != null &&
      (newest == null || activityAt > newest)) newest = activityAt;
  }
  return newest;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
