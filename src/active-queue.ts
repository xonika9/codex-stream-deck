import { threadIdentity, validTimestamp, type HostSnapshot } from "./relay-protocol.js";
import type { RoutedAgentSlot } from "./types.js";

type QueueCandidate = {
  slot: RoutedAgentSlot;
  group: number;
  activityAt: number | null;
  identity: string;
  rank?: WorkingRank;
};

type WorkingRank = {
  trustedRank?: number;
  trustedStartedAt?: number;
  inferredRank?: number;
  firstSeenOrdinal: number;
};

type RankRecord = WorkingRank & {
  disappearedAt?: number;
  previousState: QueueState;
  trustedOwner?: string;
  trustedRevision?: number;
};

type QueueState = "idle" | "completion" | "attention" | "working" | "other";

const ATTENTION_STATUSES = new Set(["approval", "awaiting-approval", "awaiting-response", "error"]);
const COMPLETION_STATUSES = new Set(["unread", "complete", "completed", "done"]);
const WORKING_STATUSES = new Set(["working", "thinking"]);
const RANK_RETENTION_MS = 24 * 60 * 60 * 1_000;

/** Queue-local, process-memory ranks for one enabled Active queue epoch. */
export class ActiveQueueRankIndex {
  private readonly records = new Map<string, RankRecord>();
  private nextFirstSeenOrdinal = 0;
  private nextTrustedFront = -1;
  private nextInferredRank = 1;

  clear(): void {
    this.records.clear();
    this.nextFirstSeenOrdinal = 0;
    this.nextTrustedFront = -1;
    this.nextInferredRank = 1;
  }

  observe(slots: readonly RoutedAgentSlot[], now = Date.now()): void {
    const present = new Set(slots.flatMap((slot) => slot.threadKey ? [queueIdentity(slot)] : []));
    this.prune(now, present);
    const newTrusted: Array<{ identity: string; slot: RoutedAgentSlot; startedAt: number; revision: number }> = [];

    for (const slot of slots) {
      if (!slot.threadKey) continue;
      const identity = queueIdentity(slot);
      const state = queueState(slot.status);
      let record = this.records.get(identity);
      const trusted = trustedStart(slot);
      if (!record) {
        record = {
          firstSeenOrdinal: this.nextFirstSeenOrdinal++,
          previousState: state
        };
        this.records.set(identity, record);
        if (trusted) newTrusted.push({ identity, slot, ...trusted });
        continue;
      }

      if (trusted) {
        if (record.trustedOwner == null) {
          newTrusted.push({ identity, slot, ...trusted });
        } else if (record.trustedOwner !== slot.host.hostId) {
          // Ownership handoff is a baseline, not a new work event.
          record.trustedOwner = slot.host.hostId;
          record.trustedRevision = trusted.revision;
        } else if (record.trustedRevision == null || trusted.revision > record.trustedRevision) {
          record.trustedRank = this.nextTrustedFront--;
          record.trustedRevision = trusted.revision;
        }
      }

      if (state === "working" && record.trustedRank == null &&
          (record.previousState === "idle" || record.previousState === "completion")) {
        record.inferredRank = this.nextInferredRank++;
      }
      record.previousState = state;
    }

    // A seed timestamp is captured once. Later receipt normalization cannot change it.
    for (const item of newTrusted) {
      const record = this.records.get(item.identity)!;
      if (record.trustedRank != null) continue;
      record.trustedRank = 0;
      record.trustedStartedAt = item.startedAt;
      record.trustedOwner = item.slot.host.hostId;
      record.trustedRevision = item.revision;
    }
  }

  rank(slot: RoutedAgentSlot): WorkingRank | undefined {
    return slot.threadKey ? this.records.get(queueIdentity(slot)) : undefined;
  }

  private prune(now: number, present: ReadonlySet<string>): void {
    for (const [identity, record] of this.records) {
      if (present.has(identity)) {
        if (record.disappearedAt != null && now - record.disappearedAt >= RANK_RETENTION_MS) {
          this.records.delete(identity);
        } else {
          record.disappearedAt = undefined;
        }
      } else if (record.disappearedAt == null) {
        record.disappearedAt = now;
      } else if (now - record.disappearedAt >= RANK_RETENTION_MS) {
        this.records.delete(identity);
      }
    }
  }
}

/**
 * Filters and ranks slots after host routing has resolved ownership and mirrors.
 * The returned ids are display positions; host/sourceSlot/threadKey still identify
 * the routed command target.
 */
export function projectActiveQueue(
  routedSlots: readonly RoutedAgentSlot[],
  inputs: readonly HostSnapshot[],
  rankIndex = new ActiveQueueRankIndex(),
  now = Date.now()
): RoutedAgentSlot[] {
  // Observe the full routed catalog before filtering and the six-item projection.
  rankIndex.observe(routedSlots, now);
  const sessionsByHost = new Map(inputs.map((input) => [input.host.hostId, input.snapshot.hostSessions ?? []]));

  return routedSlots
    .flatMap((slot): QueueCandidate[] => {
      if (!slot.threadKey) return [];
      const group = queueGroup(slot.status);
      if (group == null) return [];
      const identity = threadIdentity(slot.threadKey);
      const sessionActivity = group === 1
        ? newestMatchingSessionActivity(sessionsByHost.get(slot.host.hostId), identity)
        : null;
      return [{
        slot,
        group,
        activityAt: sessionActivity ?? validTimestamp(slot.activityAt),
        identity,
        rank: group === 2 ? rankIndex.rank(slot) : undefined
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

function queueState(status: string): QueueState {
  if (status === "idle") return "idle";
  if (ATTENTION_STATUSES.has(status)) return "attention";
  if (COMPLETION_STATUSES.has(status)) return "completion";
  if (WORKING_STATUSES.has(status)) return "working";
  return "other";
}

function compareCandidates(left: QueueCandidate, right: QueueCandidate): number {
  if (left.group !== right.group) return left.group - right.group;
  if (left.group === 2) return compareWorking(left, right);
  if (left.activityAt == null || right.activityAt == null) {
    if (left.activityAt != null) return -1;
    if (right.activityAt != null) return 1;
  } else if (left.activityAt !== right.activityAt) {
    return left.activityAt - right.activityAt;
  }
  return compareLegacyTies(left, right);
}

function compareWorking(left: QueueCandidate, right: QueueCandidate): number {
  const leftTrusted = left.rank?.trustedRank;
  const rightTrusted = right.rank?.trustedRank;
  if (leftTrusted != null || rightTrusted != null) {
    if (leftTrusted == null) return 1;
    if (rightTrusted == null) return -1;
    if (leftTrusted !== rightTrusted) return leftTrusted - rightTrusted;
    const trustedStart = (right.rank?.trustedStartedAt ?? 0) - (left.rank?.trustedStartedAt ?? 0);
    if (trustedStart) return trustedStart;
  } else {
    const leftInferred = left.rank?.inferredRank;
    const rightInferred = right.rank?.inferredRank;
    if (leftInferred != null || rightInferred != null) {
      if (leftInferred == null) return 1;
      if (rightInferred == null) return -1;
      if (leftInferred !== rightInferred) return rightInferred - leftInferred;
    }
    const firstSeen = (left.rank?.firstSeenOrdinal ?? 0) - (right.rank?.firstSeenOrdinal ?? 0);
    if (firstSeen) return firstSeen;
  }
  return compareText(queueIdentity(left.slot), queueIdentity(right.slot)) ||
    compareText(left.slot.host.hostId, right.slot.host.hostId);
}

function compareLegacyTies(left: QueueCandidate, right: QueueCandidate): number {
  return (left.slot.catalogIndex ?? left.slot.sourceSlot) - (right.slot.catalogIndex ?? right.slot.sourceSlot) ||
    left.slot.sourceSlot - right.slot.sourceSlot ||
    compareText(left.identity, right.identity) ||
    compareText(left.slot.host.hostId, right.slot.host.hostId);
}

function queueIdentity(slot: RoutedAgentSlot): string {
  return slot.conversationId
    ? `trusted:${slot.conversationId.toLowerCase()}`
    : `host:${slot.host.hostId}:exact:${slot.threadKey!.toLowerCase()}`;
}

function trustedStart(slot: RoutedAgentSlot): { startedAt: number; revision: number } | null {
  const startedAt = validTimestamp(slot.workStartedAt);
  const revision = slot.workStartRevision;
  return slot.conversationId && startedAt != null && Number.isSafeInteger(revision) && revision! >= 0
    ? { startedAt, revision: revision! }
    : null;
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
