import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  isThreadWorking as isSidebarThreadWorking,
  createInboxReturnTracker,
} from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import {
  applySidebarThreadDrop,
  belongsInSidebarWorkingShelf,
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  orderItemsByPreferredIds,
  resolveSidebarThreadSection,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
  type SidebarSection,
} from "./Sidebar.logic";

// Shared with controller navigation so returns keep their order across Settings.
export const inboxReturns = createInboxReturnTracker();

export type SidebarOptimisticDrop = {
  readonly key: string;
  readonly pinnedSectionId?: string | null;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  readonly order: readonly string[] | null;
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  readonly assignedKeys: ReadonlyMap<string, string>;
};

export interface SidebarThreadPartitionInput {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly connectedEnvironmentIds?: readonly EnvironmentId[];
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly workingShelfEnabled: boolean;
  readonly disconnectedEnvironmentIds?: ReadonlySet<EnvironmentId>;
  // Snooze wakes and the queued-turn grace depend on the clock, so the minute
  // tick and the precise snooze-wake tick are inputs: a new key repartitions.
  readonly clockKey?: string;
  readonly now?: string;
  readonly delegatedUnderParent?: ReadonlySet<string>;
  readonly sortActiveBySend?: boolean;
}

export function partitionSidebarThreads(input: SidebarThreadPartitionInput) {
  const { threads, scopedProjectKeys, serverConfigs, optimisticDrop, workingShelfEnabled } = input;
  const preciseNow = input.now ?? new Date().toISOString();
  const visible = filterSidebarV2VisibleThreads(threads, null, input.delegatedUnderParent);
  const inboxObservation = inboxReturns.observe(workingShelfEnabled ? threads : null);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const inbox = (thread: EnvironmentThreadShell, manuallyMoved = false) =>
    belongsInSidebarWorkingShelf(thread, {
      enabled: workingShelfEnabled,
      disconnectedEnvironmentIds: input.disconnectedEnvironmentIds ?? new Set(),
      isWorking: manuallyMoved ? isSidebarThreadWorking : inboxObservation.isWorking,
    })
      ? working
      : active;
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  const draggable = new Set<string>();
  const activeReorderable = new Set<string>();
  for (const thread of visible) {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const supportsSettlement = capabilities?.threadSettlement === true;
    const supportsSnooze = capabilities?.threadSnooze === true;
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const connected = input.connectedEnvironmentIds?.includes(thread.environmentId) ?? true;
    if (connected && capabilities?.threadActiveReorder === true) activeReorderable.add(threadKey);
    if (
      connected &&
      capabilities?.threadPinning === true &&
      capabilities.threadPinReorder === true
    ) {
      draggable.add(threadKey);
    }
    if (
      scopedProjectKeys !== null &&
      !scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)
    )
      continue;
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      (optimisticDrop.section === "pinned"
        ? pinned
        : optimisticDrop.section === "settled"
          ? settled
          : inbox(projected, true)
      ).push(
        optimisticDrop.clearsSnooze
          ? projected
          : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
      );
    } else {
      const section = resolveSidebarThreadSection({
        snoozed: supportsSnooze && effectiveSnoozed(thread, { now: preciseNow }),
        settled: supportsSettlement && thread.settledOverride === "settled",
        pinned: thread.pinnedAt != null,
      });
      (section === "snoozed"
        ? snoozed
        : section === "settled"
          ? settled
          : section === "pinned"
            ? pinned
            : inbox(thread)
      ).push(thread);
    }
  }
  // Server capability only gates DRAGGING — it must not influence the
  // sort, or mixed-version fleets would render different pinned orders on
  // web and mobile from the same data.
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  const sortedActive = input.sortActiveBySend
    ? sortWorkingThreadsBySend(active)
    : workingShelfEnabled
      ? sortInboxThreadsByReturn(active, inboxObservation.returnedAt)
      : sortThreadsForSidebar(active);
  return {
    pinnedThreads:
      optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
        ? sortedPinned
        : orderItemsByPreferredIds({
            items: sortedPinned,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    draggableThreadKeys: draggable,
    activeReorderableThreadKeys: activeReorderable,
    activeThreads:
      optimisticDrop?.section !== "active" || optimisticDrop.order === null
        ? sortedActive
        : orderItemsByPreferredIds({
            items: sortedActive,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    workingThreads: sortWorkingThreadsBySend(working),
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    settledThreads: sortSettledThreads(settled),
    snoozeNow: preciseNow,
    visibleThreads:
      scopedProjectKeys === null
        ? visible
        : visible.filter((thread) =>
            scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`),
          ),
  };
}
