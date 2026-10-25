import { type EnvironmentId, type ScopedProjectRef } from "@t3tools/contracts";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag as moveThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  DndContext,
  MeasuringStrategy,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";

import { FolderIcon, ListFilterIcon, PlusIcon, SettingsIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadPinnedIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { selectProjectGroupingSettings } from "../logicalProject";
import {
  projectGroupsSpanEnvironments,
  resolveSidebarProjectScopeKey,
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { useUiStateStore } from "../uiStateStore";
import {
  getThreadKeysToDeselectAfterDelete,
  useThreadSelectionStore,
} from "../threadSelectionStore";
import { useAcknowledgeThreadWoke, useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { registerSettleAndAdvance } from "../settleAndAdvance";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import {
  useEnvironmentIdentities,
  useConnectedEnvironmentIds,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "../state/environments";
import {
  readThreadShell,
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useServerConfigs,
  useQuietThreadShells,
} from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentProjects } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import { useThreadSearch } from "../state/queries";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope } from "../state/session";
import { buildThreadRouteParams, resolveActiveThreadRouteRef } from "../threadRoutes";
import type { SidebarThreadSummary } from "../types";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { cn } from "~/lib/utils";
import { ProjectEnvironmentBadge } from "./ProjectEnvironmentBadge";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
} from "./threadActionMenu.logic";
import {
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  filterSidebarProjectScopeItems,
  isSidebarNestedLinkClick,
  isTrailingDoubleClick,
  planSidebarThreadDrop,
  reduceSidebarProjectScopeMenuState,
  resolveAdjacentThreadId,
  resolveSidebarSweepKeys,
  getSidebarPinnedDestinationThreads,
  resolveSidebarDestinationTarget,
  resolveSidebarSourceTarget,
  sidebarDestinationId,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  shouldNavigateAfterThreadPark,
  sidebarListItemId,
  sidebarThreadKeyAtY,
  useThreadJumpHintVisibility,
  type SidebarListItem,
  type SidebarSection,
  resolveSidebarRowThreadId,
} from "./Sidebar.logic";
import {
  createSidebarDestinationCollisionDetection,
  measureSidebarDropTarget,
  sidebarDragTranslation,
  sidebarDragExpansion,
  canAutoScrollSidebarSource,
  positionSidebarDragCard,
} from "./Sidebar.drag";
import { SidebarDragLifecycle, SidebarPointerSensor } from "./Sidebar.pointer";
import { createSidebarListMotion } from "./Sidebar.motion";
import { resolveSnoozePresets, snoozeWakeLabel, type SnoozePreset } from "./Sidebar.snooze";
import { ProjectFavicon } from "./ProjectFavicon";
import { deriveProviderEntriesByEnvironment } from "../providerInstances";
import { useStableCallback } from "../hooks/useStableCallback";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  useComboboxFilter,
} from "./ui/combobox";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarHeaderIconButton, SidebarThreadHeader } from "./sidebar/SidebarThreadHeader";
import { TooltipProvider } from "./ui/tooltip";
import { composerDraftHasUserContent, DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import {
  SidebarSearchResultRow,
  DraggableThreadRow,
  SidebarSourceSort,
  type SidebarProviderEntry,
  type SidebarSweepAction,
} from "./sidebar/SidebarThreadRow";
import { SidebarDraftBlock } from "./sidebar/SidebarDraftBlock";
import {
  SortableSidebarMarker,
  SidebarDragBoundary,
  SidebarSectionHeader,
  SidebarSectionPlaceholder,
} from "./sidebar/SidebarListMarkers";

import { SidebarDropBox } from "./SidebarDropTargets";
import {
  PinnedSectionDialogHost,
  SidebarThreadSectionHeader,
  pinnedSectionMenuItems,
  usePinnedSectionActions,
} from "./SidebarPinnedSections";
import { publishControllerThreadTargets } from "./desktop/controllerUiState";
import { resolveControllerThreadTargets } from "./desktop/controllerThreadTargets";
import { partitionSidebarThreads, type SidebarOptimisticDrop } from "./Sidebar.threadPartition";
import { SidebarDragLayout, SidebarSourceList } from "./SidebarDragLayout";

function sameSidebarProviderEntries(
  left: ReadonlyMap<string, SidebarProviderEntry>,
  right: ReadonlyMap<string, SidebarProviderEntry>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [instanceId, entry] of right) {
    const other = left.get(instanceId);
    if (
      other === undefined ||
      other.driverKind !== entry.driverKind ||
      other.enabled !== entry.enabled ||
      other.displayName !== entry.displayName ||
      other.accentColor !== entry.accentColor ||
      other.acpRegistryAgentId !== entry.acpRegistryAgentId ||
      other.acpRegistryIconUrl !== entry.acpRegistryIconUrl ||
      other.models !== entry.models
    ) {
      return false;
    }
  }
  return true;
}

// Threads on non-primary environments (T3 Connect, hosted) resolve their
// provider entry from their own environment's config: default instance ids
// are driver slugs, so a flat map would collide across environments.
const sidebarProviderEntriesAtom = Atom.make((get) => {
  const providersByEnvironment = get(environmentPresentations.providersByEnvironmentAtom);
  const derived = deriveProviderEntriesByEnvironment(
    [...get(environmentPresentations.serverConfigsAtom)].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );
  const previous = Option.getOrNull(
    get.self<ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>>(),
  );
  const next = new Map<string, ReadonlyMap<string, SidebarProviderEntry>>();
  let changed = previous === null || previous.size !== derived.size;
  for (const [environmentId, entries] of derived) {
    const prior = previous?.get(environmentId);
    if (prior !== undefined && sameSidebarProviderEntries(prior, entries)) {
      next.set(environmentId, prior);
    } else {
      next.set(environmentId, entries);
      changed = true;
    }
  }
  return !changed && previous !== null ? previous : next;
}).pipe(Atom.withLabel("sidebar-provider-entries"));

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
// Collapsed shelves share one empty list so a route change alone does not
// give the sidebar list a new identity.
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
const PINNED_SHELF_EXPANDED_KEY = "t3code:sidebar:pinned-expanded";
const SETTLED_SHELF_EXPANDED_KEY = "t3code:sidebar:settled-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar:snoozed-expanded";
const WORKING_SHELF_EXPANDED_KEY = "t3code:sidebar:working-expanded";

function threadShellKey(thread: Pick<SidebarThreadSummary, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

const stationarySidebarSortingStrategy = () => null;

function routeThreadOnly(
  threads: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (routeThreadKey === null) return EMPTY_THREADS;
  const routeThread = threads.find((thread) => threadShellKey(thread) === routeThreadKey);
  return routeThread === undefined ? EMPTY_THREADS : [routeThread];
}

// Everything Sidebar derives from thread shells. Computed inside one hook so
// each value reaches the component frozen and cached on its real inputs: in
// the component body, later hook calls made the compiler treat these maps as
// possibly mutated and recompute them, and every dnd-kit input with them.
function useSidebarThreads(input: {
  readonly projectScopeKey: string | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly routeThreadRef: ScopedThreadRef | null;
}) {
  const { projectScopeKey, scopedProjectKeys, serverConfigs, optimisticDrop, routeThreadRef } =
    input;
  const threads = useQuietThreadShells();
  const routeRowThreadKey =
    routeThreadRef === null
      ? null
      : scopedThreadKey(
          scopeThreadRef(
            routeThreadRef.environmentId,
            resolveSidebarRowThreadId(
              routeThreadRef.threadId,
              routeThreadRef.environmentId,
              threads,
            ),
          ),
        );
  const pinnedSections = useUiStateStore((state) => state.sidebarPinnedSections);
  const workingShelfEnabled = useClientSettings((s) => s.sidebarWorkingShelfEnabled);
  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);
  const [nextSnoozeWakeAt, setNextSnoozeWakeAt] = useState<string | null>(null);
  useEffect(
    () => scheduleSnoozeWake(nextSnoozeWakeAt, () => bumpSnoozeWakeTick((tick) => tick + 1)),
    [nextSnoozeWakeAt],
  );
  const [pinnedShelfExpanded, setPinnedShelfExpanded] = useLocalStorage(
    PINNED_SHELF_EXPANDED_KEY,
    true,
    Schema.Boolean,
  );
  const [settledShelfExpanded, setSettledShelfExpanded] = useLocalStorage(
    SETTLED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useLocalStorage(
    SNOOZED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [workingShelfExpanded, setWorkingShelfExpanded] = useLocalStorage(
    WORKING_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  // The settled tail restarts whenever the project scope changes.
  const [settledTail, setSettledTail] = useState({
    scopeKey: projectScopeKey,
    count: SETTLED_TAIL_INITIAL_COUNT,
  });
  if (settledTail.scopeKey !== projectScopeKey) {
    setSettledTail({ scopeKey: projectScopeKey, count: SETTLED_TAIL_INITIAL_COUNT });
  }
  const settledVisibleCount =
    settledTail.scopeKey === projectScopeKey ? settledTail.count : SETTLED_TAIL_INITIAL_COUNT;

  const partition = partitionSidebarThreads({
    threads,
    scopedProjectKeys,
    serverConfigs,
    optimisticDrop,
    workingShelfEnabled,
    clockKey: `${nowMinute}:${snoozeWakeTick}`,
  });
  const partitionNextWakeAt = partition.snoozedThreads[0]?.snoozedUntil ?? null;
  if (partitionNextWakeAt !== nextSnoozeWakeAt) setNextSnoozeWakeAt(partitionNextWakeAt);

  const { pinnedThreads, activeThreads, workingThreads, snoozedThreads, settledThreads } =
    partition;
  const pinnedSectionIdByThreadKey = new Map(
    pinnedSections.flatMap((section) =>
      section.threadKeys.map((key) => [key, section.id] as const),
    ),
  );
  if (optimisticDrop?.section === "pinned" && optimisticDrop.pinnedSectionId !== undefined) {
    if (optimisticDrop.pinnedSectionId === null)
      pinnedSectionIdByThreadKey.delete(optimisticDrop.key);
    else pinnedSectionIdByThreadKey.set(optimisticDrop.key, optimisticDrop.pinnedSectionId);
  }
  const defaultPinnedThreads = pinnedThreads.filter(
    (thread) => !pinnedSectionIdByThreadKey.has(threadShellKey(thread)),
  );
  const visibleDefaultPinnedThreads = pinnedShelfExpanded
    ? defaultPinnedThreads
    : routeThreadOnly(defaultPinnedThreads, routeRowThreadKey);
  const namedPinnedSections = pinnedSections.map((section) => {
    const sectionThreads = pinnedThreads.filter(
      (thread) => pinnedSectionIdByThreadKey.get(threadShellKey(thread)) === section.id,
    );
    return {
      section,
      threads: sectionThreads,
      visibleThreads: section.collapsed
        ? routeThreadOnly(sectionThreads, routeRowThreadKey)
        : sectionThreads,
    };
  });
  const visibleSettledThreads = (() => {
    if (settledThreads.length <= settledVisibleCount) return settledThreads;
    const visible = settledThreads.slice(0, settledVisibleCount);
    if (routeRowThreadKey !== null) {
      const routeThread = settledThreads
        .slice(settledVisibleCount)
        .find((thread) => threadShellKey(thread) === routeRowThreadKey);
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  })();
  const renderedSettledThreads = settledShelfExpanded
    ? visibleSettledThreads
    : routeThreadOnly(visibleSettledThreads, routeRowThreadKey);
  const visibleSnoozedThreads = snoozedShelfExpanded
    ? snoozedThreads
    : routeThreadOnly(snoozedThreads, routeRowThreadKey);
  const visibleWorkingThreads = workingShelfExpanded
    ? workingThreads
    : routeThreadOnly(workingThreads, routeRowThreadKey);
  const orderedThreads = [
    ...visibleDefaultPinnedThreads,
    ...namedPinnedSections.flatMap((section) => section.visibleThreads),
    ...activeThreads,
    ...visibleWorkingThreads,
    ...visibleSnoozedThreads,
    ...renderedSettledThreads,
  ];
  const sectionByThreadKey = new Map<string, SidebarSection>();
  for (const [list, section] of [
    [pinnedThreads, "pinned"],
    [activeThreads, "active"],
    [workingThreads, "working"],
    [snoozedThreads, "snoozed"],
    [settledThreads, "settled"],
  ] as const) {
    for (const thread of list) sectionByThreadKey.set(threadShellKey(thread), section);
  }
  return {
    routeRowThreadKey,
    defaultPinnedThreads,
    visibleDefaultPinnedThreads,
    pinnedShelfExpanded,
    togglePinnedShelf: () => setPinnedShelfExpanded((value) => !value),
    namedPinnedSections,
    pinnedSectionIdByThreadKey,
    ...partition,
    threads,
    workingShelfEnabled,
    searchableThreads: [
      ...pinnedThreads,
      ...activeThreads,
      ...workingThreads,
      ...snoozedThreads,
      ...settledThreads,
    ],
    settledVisibleCount,
    hiddenSettledCount: settledThreads.length - visibleSettledThreads.length,
    showMoreSettled: () =>
      setSettledTail((current) => ({
        scopeKey: current.scopeKey,
        count: current.count + SETTLED_TAIL_PAGE_COUNT,
      })),
    settledShelfExpanded,
    toggleSettledShelf: () => setSettledShelfExpanded((value) => !value),
    snoozedShelfExpanded,
    toggleSnoozedShelf: () => setSnoozedShelfExpanded((value) => !value),
    workingShelfExpanded,
    toggleWorkingShelf: () => setWorkingShelfExpanded((value) => !value),
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    orderedThreadKeys: orderedThreads.map(threadShellKey),
    threadByKey: new Map(
      [
        ...pinnedThreads,
        ...activeThreads,
        ...workingThreads,
        ...snoozedThreads,
        ...settledThreads,
      ].map((thread) => [threadShellKey(thread), thread] as const),
    ),
    settledThreadKeys: new Set(settledThreads.map(threadShellKey)),
    snoozedThreadKeys: new Set(snoozedThreads.map(threadShellKey)),
    sectionByThreadKey,
    pinnedKeys: pinnedThreads.map(threadShellKey),
    pinnedDestinationKeys: getSidebarPinnedDestinationThreads(
      threads,
      serverConfigs,
      partition.snoozeNow,
    ).map(threadShellKey),
    activeKeys: activeThreads.map(threadShellKey),
    pinnedKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.pinOrderKey ?? null] as const),
    ),
    activeKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.activeOrderKey ?? null] as const),
    ),
  };
}

function isOptimisticDropReleased(input: {
  readonly optimisticDrop: SidebarOptimisticDrop;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly pinnedKeys: readonly string[];
  readonly activeKeys: readonly string[];
  readonly now: string;
}): boolean {
  const { optimisticDrop, threads, pinnedKeys, activeKeys, now } = input;
  const canonicalByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
    ]),
  );
  const thread = canonicalByKey.get(optimisticDrop.key);
  if (thread === undefined || thread.archivedAt !== null) {
    return true;
  }
  const canonicalSection = effectiveSnoozed(thread, { now })
    ? "snoozed"
    : thread.settledOverride === "settled"
      ? "settled"
      : thread.pinnedAt != null
        ? "pinned"
        : "active";
  if (
    canonicalSection !== optimisticDrop.sourceSection &&
    canonicalSection !== optimisticDrop.section
  ) {
    return true;
  }
  if (optimisticDrop.order === null) {
    // Settle also emits unpin/unsnooze events. Wait for the entire move
    // before releasing the projected fields and sort timestamps.
    if (
      canonicalSection === optimisticDrop.section &&
      thread.pinnedAt == null &&
      (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
    ) {
      return true;
    }
    return false;
  }
  if (canonicalSection !== optimisticDrop.section) return false;
  if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return false;
  const destinationKeys = optimisticDrop.section === "pinned" ? pinnedKeys : activeKeys;
  const canonicalDestination = [
    ...new Set([...destinationKeys, ...optimisticDrop.assignedKeys.keys()]),
  ].flatMap((key) => {
    const canonical = canonicalByKey.get(key);
    return canonical === undefined ? [] : [canonical];
  });
  const keyByThread = new Map(
    canonicalDestination.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      (optimisticDrop.section === "pinned" ? thread.pinOrderKey : thread.activeOrderKey) ?? null,
    ]),
  );
  const heldOrder = optimisticDrop.order;
  const heldKeys = new Set(heldOrder);
  const membershipChanged =
    destinationKeys.length !== heldOrder.length ||
    destinationKeys.some((key) => !heldKeys.has(key));
  const foreignKeyLanded = destinationKeys.some((threadKey) => {
    const currentKey = keyByThread.get(threadKey) ?? null;
    if (currentKey === (optimisticDrop.keysAtDrop.get(threadKey) ?? null)) return false;
    return currentKey !== optimisticDrop.assignedKeys.get(threadKey);
  });
  const allAssignmentsLanded = [...optimisticDrop.assignedKeys].every(
    ([threadKey, orderKey]) => keyByThread.get(threadKey) === orderKey,
  );
  return membershipChanged || foreignKeyLanded || allAssignmentsLanded;
}

// Sidebar() is large enough that the compiler cannot prove its local maps stay
// unmutated; built inside a hook they reach it frozen and cached.
function useSidebarLookups() {
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const serverConfigs = useServerConfigs();
  const providerEntriesByEnvironment = useAtomValue(sidebarProviderEntriesAtom);
  const projectGroups = useSidebarProjectGroups();
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const projectDisplayNameByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
  const projectGroupByScopeKey = new Map(
    projectGroups.map((project) => [project.projectKey, project] as const),
  );
  const projectScopeItems = [
    { value: "all", label: "All projects" },
    ...projectGroups.map((project) => ({ value: project.projectKey, label: project.displayName })),
  ];
  return {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
    projectGroupByScopeKey,
    projectScopeItems,
  };
}

function scheduleSnoozeWake(wakeAt: string | null, onWake: () => void): (() => void) | undefined {
  const wakeAtMs = wakeAt === null ? Number.NaN : Date.parse(wakeAt);
  if (Number.isNaN(wakeAtMs)) return undefined;
  // setTimeout delays are signed 32-bit: anything larger overflows and fires
  // immediately, turning a far-future wake (event-condition snoozes synced
  // from elsewhere) into a tight re-arm loop.
  const delayMs = Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647);
  const id = window.setTimeout(onWake, delayMs);
  return () => window.clearTimeout(id);
}

function canOperateThreads(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  return threads.every((thread) =>
    readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
  );
}

function checkThreadOperations(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  if (canOperateThreads(threads)) return true;
  toastManager.add({
    type: "error",
    title: "Thread action unavailable",
    description: "This connection cannot change one or more selected threads.",
  });
  return false;
}

const SIDEBAR_DRAG_DISTANCE = 6;

export default function Sidebar() {
  const {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
    projectGroupByScopeKey,
    projectScopeItems,
  } = useSidebarLookups();
  const compactSections = useUiStateStore((state) => state.sidebarCompactSections);
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    reorderPinnedThread,
    reorderActiveThread,
    markThreadUnread,
    archiveThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ({ threadId }) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const newThreadContext = useHandleNewThread();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const routeTarget = useThreadRouteTarget();
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const environmentMachineById = useEnvironmentMachines();
  const projectGroupsRef = useRef(projectGroups);
  const persistedProjectScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setPersistedProjectScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const [projectScopeMenuState, dispatchProjectScopeMenu] = useReducer(
    reduceSidebarProjectScopeMenuState,
    { open: false, query: "" },
  );
  const projectScopeFilter = useComboboxFilter();
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const allProjectConfigsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);
  // Safari can send a click after Ctrl+click opens settings. Ignore that one
  // selection, then clear the guard when the picker opens again.
  const suppressNextScopeChangeRef = useRef(false);
  const highlightedProjectScopeKeyRef = useRef<string | null>(null);
  // Keep a dropped row at its destination while its server applies the
  // lifecycle command and any order-key writes. The next pickup waits for
  // this hold so a second drop cannot replace an unconfirmed placement.
  const [optimisticDrop, setOptimisticDrop] = useState<SidebarOptimisticDrop | null>(null);
  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [searchHighlight, setSearchHighlight] = useState({ orderKey: "", index: 0 });
  const searchEnvironmentIds = useConnectedEnvironmentIds();
  const threadSearch = useThreadSearch(searchEnvironmentIds, threadSearchQuery);
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const settlingThreadKeysRef = useRef(new Set<string>());
  const threadListRef = useRef<HTMLUListElement | null>(null);
  const dragAnchorRef = useRef<{ grabFraction: number; cardHeight: number } | null>(null);
  const dragSourceBoundsRef = useRef<{ top: number; bottom: number } | null>(null);
  const dragSourceReturnBoundsRef = useRef<{ top: number; bottom: number } | null>(null);
  const dragPointerYRef = useRef(0);
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarSection;
    readonly sourceRowHeight: number | undefined;
    readonly pinnedSectionId: string | null;
    readonly dropBounds: { top: number; left: number; width: number; height: number };
    readonly outsideSource: boolean;
    readonly contextDrag: boolean;
  } | null>(null);
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  const contextDragKeyRef = useRef<string | null>(null);
  const [actionSweep, setActionSweep] = useState<{
    action: SidebarSweepAction;
    keys: ReadonlySet<string>;
  } | null>(null);
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const openAddProjectCommandPalette = () => openCommandPalette({ open: "add-project" });
  const routeThreadRef = resolveActiveThreadRouteRef(routeTarget, routeDraftThread);
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeThreadKeyRef = useRef(routeThreadKey);

  // A selection made under one scope can hold threads the next scope hides.
  const setProjectScopeKey = (key: string | null) => {
    clearSelection();
    setPersistedProjectScopeKey(key);
  };
  const projectScopeKey = resolveSidebarProjectScopeKey({
    groups: projectGroups,
    key: persistedProjectScopeKey,
    settings: projectGroupingSettings,
  });
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const scratchMachineLabelFor = (
    thread: Pick<SidebarThreadSummary, "environmentId" | "projectId">,
  ) => {
    if (!showProjectEnvironments) return null;
    const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (
      !project ||
      !isScratchProject(project, serverConfigs.get(thread.environmentId)?.scratchWorkspaceRoot)
    ) {
      return null;
    }
    return environmentLabelById.get(thread.environmentId) ?? null;
  };
  const selectedProjectScopeItem =
    projectScopeItems.find((item) => item.value === (projectScopeKey ?? "all")) ??
    projectScopeItems[0]!;
  const filteredProjectScopeItems = filterSidebarProjectScopeItems({
    items: projectScopeItems,
    query: projectScopeMenuState.query,
    matches: (item, query) =>
      projectScopeFilter.contains(item, query, (candidate) => candidate.label),
  });
  const scopedProjectGroup =
    projectScopeKey === null
      ? null
      : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null);
  const scopedProjectKeys =
    scopedProjectGroup === null
      ? null
      : new Set(
          scopedProjectGroup.memberProjectRefs.map(
            (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
          ),
        );
  useEffect(() => {
    const nextKey = resolveSidebarProjectScopeKey({
      groups: projectGroups,
      key: persistedProjectScopeKey,
      settings: projectGroupingSettings,
      canClearMissingScope: allProjectSnapshotsReady && allProjectConfigsReady,
    });
    if (nextKey !== persistedProjectScopeKey) {
      clearSelection();
      setPersistedProjectScopeKey(nextKey);
    }
  }, [
    allProjectConfigsReady,
    allProjectSnapshotsReady,
    clearSelection,
    persistedProjectScopeKey,
    projectGroups,
    projectGroupingSettings,
    setPersistedProjectScopeKey,
  ]);
  const routeDraftIdForRows = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const visibleDraftSessionCount = useComposerDraftStore((store) => {
    let count = 0;
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (!composerDraftHasUserContent(store.draftsByThreadKey[draftKey])) {
        continue;
      }
      if (
        scopedProjectKeys !== null &&
        !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  });

  const openProjectSettings = useStableCallback(
    (projectGroup: SidebarProjectSnapshot, projectRef?: ScopedProjectRef) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: {
          projectKey: getSidebarProjectSettingsKey(
            projectGroup,
            projectGroupingSettings,
            projects,
            projectRef,
          ),
        },
      });
    },
  );
  const handleProjectSettings = useStableCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLInputElement>,
      projectGroup: SidebarProjectSnapshot,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextScopeChangeRef.current = true;
      dispatchProjectScopeMenu({ type: "project-settings-opened" });
      openProjectSettings(projectGroup);
    },
  );

  const {
    threads,
    workingShelfEnabled,
    pinnedThreads,
    defaultPinnedThreads,
    visibleDefaultPinnedThreads,
    pinnedShelfExpanded,
    togglePinnedShelf,
    namedPinnedSections,
    pinnedSectionIdByThreadKey,
    draggableThreadKeys,
    activeReorderableThreadKeys,
    activeThreads,
    workingThreads,
    snoozedThreads,
    settledThreads,
    snoozeNow,
    searchableThreads,
    hiddenSettledCount,
    showMoreSettled,
    settledShelfExpanded,
    toggleSettledShelf,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    workingShelfExpanded,
    toggleWorkingShelf,
    renderedSettledThreads,
    visibleSnoozedThreads,
    visibleWorkingThreads,
    orderedThreadKeys,
    threadByKey,
    settledThreadKeys,
    snoozedThreadKeys,
    sectionByThreadKey,
    pinnedKeys,
    pinnedDestinationKeys,
    activeKeys,
    pinnedKeysById,
    activeKeysById,
    routeRowThreadKey,
  } = useSidebarThreads({
    projectScopeKey,
    scopedProjectKeys,
    serverConfigs,
    optimisticDrop,
    routeThreadRef,
  });
  useLayoutEffect(() => {
    publishControllerThreadTargets(
      resolveControllerThreadTargets({
        activeThreads,
        pinnedThreads,
        pinnedSections: namedPinnedSections.map(({ section, threads }) => ({
          ...section,
          threadKeys: threads.map(threadShellKey),
        })),
      }),
    );
  }, [activeThreads, pinnedThreads, namedPinnedSections]);
  useLayoutEffect(() => () => publishControllerThreadTargets(null), []);

  const handlePinnedSectionAction = usePinnedSectionActions();
  const isSearchingThreads = threadSearchQuery.trim().length > 0;
  const threadSearchMatchByKey = new Map(
    threadSearch.matches.map((match) => [threadSearchMatchKey(match), match] as const),
  );
  const threadSearchResults = searchSidebarThreads(
    searchableThreads,
    threadSearchQuery,
    new Set(threadSearchMatchByKey.keys()),
  );
  const threadSearchResultOrderKey = threadSearchResults
    .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    .join("\0");

  // The highlight belongs to one result list; a new list starts at the top.
  const activeSearchResultIndex =
    searchHighlight.orderKey === threadSearchResultOrderKey ? searchHighlight.index : 0;
  const setActiveSearchResultIndex = (index: number | ((index: number) => number)) =>
    setSearchHighlight((current) => {
      const currentIndex = current.orderKey === threadSearchResultOrderKey ? current.index : 0;
      return {
        orderKey: threadSearchResultOrderKey,
        index: typeof index === "function" ? index(currentIndex) : index,
      };
    });
  const activeSearchResult = isSearchingThreads
    ? threadSearchResults[activeSearchResultIndex]
    : undefined;
  const activeSearchResultKey =
    activeSearchResult === undefined
      ? null
      : scopedThreadKey(scopeThreadRef(activeSearchResult.environmentId, activeSearchResult.id));
  useEffect(() => {
    if (activeSearchResultKey === null) return;
    document
      .querySelector(`[data-search-result-key="${globalThis.CSS.escape(activeSearchResultKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultKey]);

  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  const settledThreadKeysRef = useRef(settledThreadKeys);
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);

  const jumpLabelByKey = (() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  })();
  const { showThreadJumpHints: showJumpHints, updateThreadJumpHintsVisibility } =
    useThreadJumpHintVisibility();

  const navigateToThread = (threadRef: ScopedThreadRef) => {
    if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
      clearSelection();
    }
    setSelectionAnchor(scopedThreadKey(threadRef));
    if (isMobile) {
      setOpenMobile(false);
    }
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

  const handleThreadFileDrop = async (threadRef: ScopedThreadRef, files: File[]) => {
    const dropId = queuePendingFileDrop({ threadRef, files });
    const landedBefore =
      router.buildLocation({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      }).pathname === router.state.location.pathname;
    if (landedBefore) return;

    try {
      await navigateToThread(threadRef);
      const landed =
        router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }).pathname === router.state.location.pathname;
      if (!landed) clearPendingFileDrop(dropId);
    } catch {
      clearPendingFileDrop(dropId);
    }
  };

  const navigateToDraft = (draftId: DraftId) => {
    clearSelection();
    if (isMobile) {
      setOpenMobile(false);
    }
    void router.navigate({ to: "/draft/$draftId", params: { draftId } });
  };

  const clearThreadSearch = () => {
    setThreadSearchQuery("");
    setActiveSearchResultIndex(0);
  };
  const selectThreadSearchResult = (thread: EnvironmentThreadShell) => {
    clearThreadSearch();
    navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
  };
  const handleThreadSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && isSearchingThreads) {
      event.preventDefault();
      event.stopPropagation();
      clearThreadSearch();
      return;
    }
    if (threadSearchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchResultIndex((index) => (index + 1) % threadSearchResults.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchResultIndex(
        (index) => (index - 1 + threadSearchResults.length) % threadSearchResults.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = threadSearchResults[activeSearchResultIndex];
      if (result) selectThreadSearchResult(result);
    }
  };

  const startThreadRename = (threadRef: ScopedThreadRef, title: string) => {
    if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  };
  const cancelThreadRename = () => setRenamingThreadKey(null);
  const commitThreadRename = (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const trimmed = title.trim();
      setRenamingThreadKey(null);
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (trimmed === originalTitle) return;
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const handleThreadClick = (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
    if (isSidebarNestedLinkClick(event.target)) return;
    const isMac = isMacPlatform(navigator.platform);
    const isModClick = isMac ? event.metaKey : event.ctrlKey;
    const threadKey = scopedThreadKey(threadRef);
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(threadKey);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectTo(threadKey, orderedThreadKeysRef.current);
      return;
    }
    if (isTrailingDoubleClick(event.detail)) {
      return;
    }
    navigateToThread(threadRef);
  };

  // Callers snapshot the plan BEFORE the command mutates the partition;
  // background parks never navigate (null plan).
  const planForwardNavigation = (
    threadKey: string,
    coParkingKeys?: ReadonlySet<string>,
  ): (() => void) | null => {
    if (routeThreadKeyRef.current !== threadKey) return null;
    const shell = threadByKeyRef.current.get(threadKey);
    const orderedKeys = orderedThreadKeysRef.current;
    const settledKeys = settledThreadKeysRef.current;
    const snoozedKeys = snoozedThreadKeysRef.current;
    const currentIndex = orderedKeys.indexOf(threadKey);
    const nextCardKey =
      currentIndex === -1
        ? null
        : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
            (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
          ) ?? null);
    const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
    return nextThread
      ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
      : shell
        ? () =>
            void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
        : () => void router.navigate({ to: "/" });
  };

  const attemptSettle = (
    threadRef: ScopedThreadRef,
    opts: { coSettlingKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      if (settlingThreadKeysRef.current.has(threadKey)) return;
      settlingThreadKeysRef.current.add(threadKey);
      const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
      const result = await settleThread(threadRef);
      settlingThreadKeysRef.current.delete(threadKey);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      if (
        shouldNavigateAfterThreadPark({
          threadKey,
          currentThreadKey: routeThreadKeyRef.current,
          action: "settle",
          now: new Date().toISOString(),
          thread: readThreadShell(threadRef),
        })
      ) {
        navigateAfterSettle?.();
      }
    })();
  };
  useEffect(() => registerSettleAndAdvance(attemptSettle), [attemptSettle]);
  const settleThreads = (threadKeys: readonly string[]) => {
    const coSettlingKeys = new Set(threadKeys);
    for (const threadKey of threadKeys) {
      const thread = threadByKeyRef.current.get(threadKey);
      if (!thread || thread.settledOverride === "settled") continue;
      attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
    }
  };
  const attemptUnsettle = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsettleThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to un-settle thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnsnooze = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsnoozeThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to wake thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const positionDragCard = useStableCallback(() => {
    const anchor = dragAnchorRef.current;
    if (!anchor || !dragState) return;
    const node = threadListRef.current?.querySelector<HTMLElement>(
      "[data-thread-item][data-thread-dragging]",
    );
    if (!node) return;
    positionSidebarDragCard(node, {
      pointerY: dragPointerYRef.current,
      grabFraction: anchor.grabFraction,
      bounds: dragState.dropBounds,
    });
  });
  useLayoutEffect(positionDragCard);
  const anchorSidebarDrag: Modifier = (args) => {
    const anchor = dragAnchorRef.current;
    const node = threadListRef.current?.querySelector<HTMLElement>(
      "[data-thread-item][data-thread-dragging]",
    );
    if (!anchor || !node || !dragState) return args.transform;
    const card = node.querySelector<HTMLElement>('[role="button"]') ?? node;
    const rect = card.getBoundingClientRect();
    const bounds = dragState.dropBounds;
    // Section containers and compact siblings move the source's layout slot.
    // Anchor the held card to the original pointer grab point instead.
    return {
      ...args.transform,
      x: 0,
      y: sidebarDragTranslation({
        pointerY: dragPointerYRef.current,
        grabFraction: anchor.grabFraction,
        cardHeight: rect.height,
        bounds,
        originTop: args.draggingNodeRect?.top ?? 0,
      }),
    };
  };
  const dndModifiers = [anchorSidebarDrag];
  const attachListMotionRef = (node: HTMLUListElement | null) => {
    threadListRef.current = node;
    listMotionRef.current?.dispose();
    listMotionRef.current = node === null ? null : createSidebarListMotion(node);
    listMotionRef.current?.update(false);
  };

  // Working rows can supply chat context, but never preview sidebar movement.
  const isContextDrag = dragState?.contextDrag === true || dragState?.activeSection === "working";
  const finishThreadDrag = (started: boolean) => {
    dragSensorRef.current = null;
    contextDragKeyRef.current = null;
    endThreadContextDrag();
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  };
  const attachDragSensor = (sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  };
  const cancelThreadDrag = () => {
    dragSensorRef.current?.cancel();
  };
  const contextDragThreads = (): ReadonlyArray<ScopedThreadRef> => {
    const key = contextDragKeyRef.current;
    if (key === null) return [];
    const selected = useThreadSelectionStore.getState().selectedThreadKeys;
    const keys = selected.has(key) ? [...selected] : [key];
    return keys.flatMap((candidate) => {
      const ref = parseScopedThreadKey(candidate);
      return ref ? [ref] : [];
    });
  };
  const pointerOutsideThreadList = (point: { x: number; y: number }) => {
    const bounds = threadListRef.current?.getBoundingClientRect();
    return bounds !== undefined && (point.x < bounds.left || point.x > bounds.right);
  };
  const readDragExpansion = useStableCallback(() =>
    dragState === null
      ? null
      : sidebarDragExpansion({
          pointerY: dragPointerYRef.current,
          anchor: dragAnchorRef.current,
          sourceBounds: dragState.outsideSource
            ? dragSourceReturnBoundsRef.current
            : dragSourceBoundsRef.current,
          sourceSection: dragState.activeSection,
          pinnedAreaBottom: threadListRef.current
            ?.querySelector('[data-sidebar-marker="pinned-divider"]')
            ?.getBoundingClientRect().top,
          expanded: dragState.outsideSource,
        }),
  );
  const moveThreadContextDrag = (point: { x: number; y: number }) => {
    dragPointerYRef.current = point.y;
    positionDragCard();
    const contextDrag = pointerOutsideThreadList(point);
    const expansion = contextDrag ? null : readDragExpansion();
    setDragState((current) => {
      if (current === null) return current;
      const outsideSource = expansion?.expanded ?? current.outsideSource;
      return current.contextDrag === contextDrag && current.outsideSource === outsideSource
        ? current
        : {
            ...current,
            contextDrag,
            outsideSource,
          };
    });
    if (!contextDrag) {
      endThreadContextDrag();
      return false;
    }
    const threads = contextDragThreads();
    const title =
      threadByKeyRef.current.get(contextDragKeyRef.current ?? "")?.title.trim() || "Thread";
    moveThreadContextDragGhost(point, { title, count: threads.length });
    return true;
  };
  const dropThreadContextDrag = (point: { x: number; y: number }) => {
    if (!pointerOutsideThreadList(point)) return false;
    dropThreadContext(point, contextDragThreads());
    return true;
  };
  // useSensor memoizes on the options object; a fresh one each render rebuilds
  // the sensors, and with them DndContext and every sortable row.
  const pointerSensorOptions = {
    distance: SIDEBAR_DRAG_DISTANCE,
    onAttach: attachDragSensor,
    onFinish: finishThreadDrag,
    onMove: moveThreadContextDrag,
    onDrop: dropThreadContextDrag,
  };
  const dndSensors = useSensors(useSensor(SidebarPointerSensor, pointerSensorOptions));
  const sectionByThreadKeyRef = useRef(sectionByThreadKey);
  useLayoutEffect(() => {
    routeThreadKeyRef.current = routeThreadKey;
    projectGroupsRef.current = projectGroups;
    orderedThreadKeysRef.current = orderedThreadKeys;
    threadByKeyRef.current = threadByKey;
    handleNewThreadRef.current = newThreadContext.handleNewThread;
    settledThreadKeysRef.current = settledThreadKeys;
    snoozedThreadKeysRef.current = snoozedThreadKeys;
    sectionByThreadKeyRef.current = sectionByThreadKey;
  });
  const startActionSweep = useStableCallback(
    (threadRef: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
      const originKey = scopedThreadKey(threadRef);
      const originSection = sectionByThreadKeyRef.current.get(originKey);
      const canApply = (key: string) => {
        const thread = threadByKeyRef.current.get(key);
        const capabilities =
          thread && serverConfigs.get(thread.environmentId)?.environment.capabilities;
        return (
          thread !== undefined &&
          sectionByThreadKeyRef.current.get(key) === originSection &&
          (action === "unsnooze"
            ? capabilities?.threadSnooze === true
            : capabilities?.threadSettlement === true)
        );
      };
      let targetKey: string | null = null;
      let sweptKeys: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedThreadKeysRef.current, originKey, key, canApply);
        setActionSweep({ action, keys: new Set(sweptKeys) });
      };
      dragSensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: SIDEBAR_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            dragSensorRef.current = null;
            setActionSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) =>
          sweepTo(threadListRef.current && sidebarThreadKeyAtY(threadListRef.current, y)),
        onEnd: () => {
          const keys = sweptKeys.filter(canApply);
          if (action === "settle") {
            settleThreads(keys);
            return;
          }
          for (const key of keys) {
            const ref = parseScopedThreadKey(key);
            if (ref === null) continue;
            if (action === "unsettle") attemptUnsettle(ref);
            else attemptUnsnooze(ref);
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
  );
  // Release the hold during render once the server state catches up, so the
  // canonical order shows in the same frame instead of after an effect pass.
  if (
    optimisticDrop !== null &&
    (optimisticDrop.section !== "pinned" ||
      (namedPinnedSections.find(({ section }) => section.threadKeys.includes(optimisticDrop.key))
        ?.section.id ?? null) === (optimisticDrop.pinnedSectionId ?? null)) &&
    isOptimisticDropReleased({
      optimisticDrop,
      threads,
      pinnedKeys:
        optimisticDrop.section === "pinned"
          ? pinnedKeys.filter(
              (key) =>
                (pinnedSectionIdByThreadKey.get(key) ?? null) ===
                (optimisticDrop.pinnedSectionId ?? null),
            )
          : pinnedKeys,
      activeKeys,
      now: snoozeNow,
    })
  ) {
    setOptimisticDrop(null);
  }
  const attemptPin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await pinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to pin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnpin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await confirmAndUnpinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to unpin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const handleThreadDragStart = (event: DragStartEvent) => {
    const activeKey = String(event.active.id);
    contextDragKeyRef.current = activeKey;
    const activeSection = sectionByThreadKey.get(activeKey);
    if (activeSection === undefined) return;
    listMotionRef.current?.suspend();
    const list = threadListRef.current;
    const sourceNode = [...(list?.querySelectorAll<HTMLElement>("[data-thread-item]") ?? [])].find(
      (node) => node.dataset.threadItem === activeKey,
    );
    const pointerY = (event.activatorEvent as PointerEvent).clientY;
    const sourceRect = sourceNode?.getBoundingClientRect();
    const cardRect =
      sourceNode?.querySelector<HTMLElement>('[role="button"]')?.getBoundingClientRect() ??
      sourceRect;
    dragAnchorRef.current = {
      cardHeight: cardRect?.height ?? 0,
      grabFraction:
        cardRect && cardRect.height > 0
          ? Math.max(0, Math.min(1, (pointerY - cardRect.top) / cardRect.height))
          : 0,
    };
    dragPointerYRef.current = pointerY;
    const pinnedSectionId =
      activeSection === "pinned" ? (pinnedSectionIdByThreadKey.get(activeKey) ?? null) : null;
    const sourceNodes = [
      ...(list?.querySelectorAll<HTMLElement>("[data-thread-item]") ?? []),
    ].filter((node) => {
      const key = node.dataset.threadItem!;
      return (
        sectionByThreadKey.get(key) === activeSection &&
        (activeSection !== "pinned" ||
          (pinnedSectionIdByThreadKey.get(key) ?? null) === pinnedSectionId)
      );
    });
    const firstSource = sourceNodes[0];
    const lastSource = sourceNodes.at(-1);
    dragSourceBoundsRef.current = {
      top: firstSource?.previousElementSibling?.getBoundingClientRect().top ?? sourceRect?.top ?? 0,
      bottom: lastSource?.getBoundingClientRect().bottom ?? sourceRect?.bottom ?? 0,
    };
    dragSourceReturnBoundsRef.current = null;
    const viewport = list?.closest('[data-slot="scroll-area-viewport"]')?.getBoundingClientRect();
    const listRect = list?.getBoundingClientRect();
    const top = Math.max(viewport?.top ?? 0, listRect?.top ?? 0);
    const group = list?.closest<HTMLElement>('[data-sidebar="group"]');
    const bottomInset = group ? Number.parseFloat(getComputedStyle(group).paddingBottom) || 0 : 0;
    setDragState({
      activeKey,
      activeSection,
      sourceRowHeight: sourceRect?.height,
      pinnedSectionId,
      outsideSource: false,
      // Destinations fill the visible sidebar even when the thread list scrolls.
      dropBounds: {
        top,
        left: listRect?.left ?? 0,
        width: listRect?.width ?? 0,
        height: Math.max(0, (viewport?.bottom ?? top) - top - bottomInset),
      },
      contextDrag: false,
    });
  };
  const sidebarListItemsFresh = ((): readonly SidebarListItem[] => {
    const rowsOf = (
      list: readonly EnvironmentThreadShell[],
      section: SidebarSection,
    ): SidebarListItem[] =>
      list.map((thread) => {
        const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
        return { kind: "thread", key, section };
      });
    const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
    const pinnedRows = rowsOf(
      dragState?.outsideSource &&
        dragState.activeSection === "pinned" &&
        dragState.pinnedSectionId === null &&
        !isContextDrag
        ? defaultPinnedThreads
        : visibleDefaultPinnedThreads,
      "pinned",
    );
    items.push(...pinnedRows);
    for (const { section, visibleThreads, threads: sectionThreads } of namedPinnedSections) {
      items.push({ kind: "marker", marker: `pinned-section:${section.id}` });
      items.push(
        ...rowsOf(
          dragState?.outsideSource &&
            dragState.activeSection === "pinned" &&
            dragState.pinnedSectionId === section.id &&
            !isContextDrag
            ? sectionThreads
            : visibleThreads,
          "pinned",
        ).map((item) => ({
          ...item,
          pinnedSectionId: section.id,
        })),
      );
    }
    items.push({ kind: "marker", marker: "pinned-divider" });
    const activeRows = rowsOf(activeThreads, "active");
    items.push({ kind: "marker", marker: "active-placeholder" });
    items.push(...activeRows);
    if (workingThreads.length > 0) {
      items.push({ kind: "marker", marker: "working-header" });
      items.push(...rowsOf(visibleWorkingThreads, "working"));
    }
    if (snoozedThreads.length > 0) {
      items.push({ kind: "marker", marker: "snoozed-header" });
      items.push(...rowsOf(visibleSnoozedThreads, "snoozed"));
    }
    items.push({ kind: "marker", marker: "settled-header" });
    const settledRows = rowsOf(renderedSettledThreads, "settled");
    items.push({ kind: "marker", marker: "settled-placeholder" });
    items.push(...settledRows);
    return items;
  })();
  // Thread shells update on every streamed event without moving rows. Keep the
  // list's identity until its order changes, so the sorting strategy, the
  // sortable context and every sortable row stay memoized meanwhile.
  const sidebarListItemsKey = sidebarListItemsFresh
    .map((item) =>
      item.kind === "thread"
        ? item.section + ":" + (item.pinnedSectionId ?? "") + ":" + item.key
        : item.marker,
    )
    .join("\n");
  const [sidebarListItemsState, setSidebarListItems] = useState(sidebarListItemsFresh);
  const [sidebarListItemsKeyState, setSidebarListItemsKeyState] = useState(sidebarListItemsKey);
  let sidebarListItems = sidebarListItemsState;
  if (sidebarListItemsKeyState !== sidebarListItemsKey) {
    setSidebarListItemsKeyState(sidebarListItemsKey);
    setSidebarListItems(sidebarListItemsFresh);
    // The rest of this render still runs before React applies the update, and
    // threadByKey already lacks rows that just left, such as a thread settled
    // into the collapsed Settled shelf.
    sidebarListItems = sidebarListItemsFresh;
  }
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => item.kind === "thread" && item.key === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);
  // Rows only move when the rendered order, a row's section, or the draft block
  // changes. Running the motion pass on that alone keeps ordinary shell events
  // from forcing a layout read and animating rows that drifted for other reasons.
  const listMotionLayoutKey = [
    sidebarListItemsKey,
    visibleDraftSessionCount,
    routeDraftIdForRows ?? "",
  ].join("\0");
  const listMotionAnimate =
    dragState === null && sidebarListItems.length + visibleDraftSessionCount > 0;
  // The effect reads only `animate`; the pass object is cached on both fields,
  // so a new layout key alone also triggers it.
  const listMotionPass = { layoutKey: listMotionLayoutKey, animate: listMotionAnimate };
  useLayoutEffect(() => {
    listMotionRef.current?.update(listMotionPass.animate);
  }, [listMotionPass]);
  const organizingDrag = dragState !== null && !isContextDrag;
  const mixedDrag = organizingDrag && dragState.outsideSource;
  const dragLayout = {
    key: `${mixedDrag}:${sidebarListItemsKey}`,
    dragging: organizingDrag,
  };
  const sourceRows = organizingDrag
    ? sidebarListItems.filter(
        (item): item is Extract<SidebarListItem, { kind: "thread" }> =>
          item.kind === "thread" &&
          item.section === dragState.activeSection &&
          (item.section !== "pinned" ||
            (item.pinnedSectionId ?? null) === dragState.pinnedSectionId),
      )
    : [];
  const sourceOrder = sourceRows.map((item) => item.key);
  const sourceKeys = new Set(sourceOrder);
  useLayoutEffect(() => {
    if (!dragLayout.dragging) return;
    const rows = [
      ...(threadListRef.current?.querySelectorAll<HTMLElement>("[data-thread-item]") ?? []),
    ].filter((node) => sourceKeys.has(node.dataset.threadItem!));
    if (!rows.length) return;
    const slots = rows.map((node) => {
      const rect = node.getBoundingClientRect();
      const translation = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { top: rect.top - translation.m42, bottom: rect.bottom - translation.m42 };
    });
    const sourceList = threadListRef.current?.querySelector<HTMLElement>(
      "[data-sidebar-source-list]",
    );
    const sourceBounds = {
      top:
        sourceList?.previousElementSibling?.getBoundingClientRect().top ??
        Math.min(...slots.map((slot) => slot.top)),
      // Empty space before the next target still belongs to the source section.
      bottom:
        sourceList?.getBoundingClientRect().bottom ?? Math.max(...slots.map((slot) => slot.bottom)),
    };
    if (mixedDrag) {
      dragSourceReturnBoundsRef.current = sourceBounds;
      return;
    }
    dragSourceBoundsRef.current = {
      // Collapsing earlier sections must not make a stationary pointer leave
      // its source. Retain the pickup area as well as the current list slots.
      top: Math.min(
        dragSourceBoundsRef.current?.top ?? Infinity,
        dragSourceReturnBoundsRef.current?.top ?? Infinity,
        sourceBounds.top,
      ),
      bottom: Math.max(
        dragSourceBoundsRef.current?.bottom ?? -Infinity,
        dragSourceReturnBoundsRef.current?.bottom ?? -Infinity,
        sourceBounds.bottom,
      ),
    };
  }, [dragLayout, mixedDrag, sourceKeys]);
  const sourceIsList = sourceRows.length > 0;
  const sourceReorderEnabled =
    organizingDrag &&
    sourceRows.length >= 2 &&
    (dragState.activeSection === "pinned" ||
      (dragState.activeSection === "active" && !workingShelfEnabled));
  const resolveDropTarget = (activeKey: string, overId: string) =>
    (sourceReorderEnabled
      ? resolveSidebarSourceTarget({
          activeKey,
          overId,
          section: dragState.activeSection,
          pinnedSectionId: dragState.pinnedSectionId,
          sourceKeys,
          pinnedOrder: pinnedKeys,
          activeOrder: activeKeys,
          pinnedSectionIdByThreadKey,
        })
      : null) ??
    resolveSidebarDestinationTarget({
      activeKey,
      overId,
      pinnedOrder: pinnedDestinationKeys,
      activeOrder: activeKeys,
      pinnedSectionIds: namedPinnedSections.map(({ section }) => section.id),
      pinnedSectionIdByThreadKey,
    });
  const sortableIds = sidebarListItems.map(sidebarListItemId);
  const isValidDropTarget = (id: string) => {
    if (!dragState || isContextDrag) return false;
    const source = threadByKey.get(dragState.activeKey);
    const target = resolveDropTarget(dragState.activeKey, id);
    if (!source || !target) return false;
    const plan = planSidebarThreadDrop({
      activeKey: dragState.activeKey,
      activeSection: dragState.activeSection,
      activePinned: source.pinnedAt != null,
      activeSettled: source.settledOverride === "settled",
      supportsSettlement:
        serverConfigs.get(source.environmentId)?.environment.capabilities.threadSettlement === true,
      target,
      pinnedOrder:
        target.section === "pinned"
          ? (id.startsWith("sidebar-destination:") ? pinnedDestinationKeys : pinnedKeys).filter(
              (key) =>
                (pinnedSectionIdByThreadKey.get(key) ?? null) === (target.pinnedSectionId ?? null),
            )
          : pinnedKeys,
      pinnedKeysById,
      reorderableKeys: draggableThreadKeys,
      activeOrder: activeKeys,
      activeKeysById,
      activeReorderableKeys: activeReorderableThreadKeys,
      activeTimeOrdered: workingShelfEnabled,
    });
    if (plan.kind === "blocked") return false;
    if (target.section === "pinned" && source.pinnedAt != null) return true;
    if (dragState.activeSection === target.section) return true;
    if (!readEnvironmentScope(source.environmentId, AuthOrchestrationOperateScope)) return false;
    return plan.kind !== "none";
  };
  const dropDestinations = [
    { id: sidebarDestinationId("pinned"), label: "Pinned", count: defaultPinnedThreads.length },
    ...namedPinnedSections.map(({ section, threads }) => ({
      id: sidebarDestinationId("pinned", section.id),
      label: section.name,
      count: threads.length,
    })),
    { id: sidebarDestinationId("active"), label: "Active", count: activeThreads.length },
    {
      id: sidebarDestinationId("settled"),
      label: "Settled",
      count: settledThreads.length,
      size: "half" as const,
    },
  ].map((destination) => ({ ...destination, disabled: !isValidDropTarget(destination.id) }));
  const readHeldCardRect = useStableCallback(() =>
    threadListRef.current
      ?.querySelector<HTMLElement>('[data-thread-dragging] [role="button"]')
      ?.getBoundingClientRect(),
  );
  const dndCollisionDetection = createSidebarDestinationCollisionDetection(
    isValidDropTarget,
    sourceReorderEnabled ? sourceKeys : new Set(),
    readHeldCardRect,
  );
  const handleThreadDragEnd = (event: DragEndEvent) => {
    const activeKey = String(event.active.id);
    const activeSection = sectionByThreadKey.get(activeKey);
    const target = event.over === null ? null : resolveDropTarget(activeKey, String(event.over.id));
    const activeThread = threadByKey.get(activeKey);
    if (activeSection === undefined || target === null || activeThread === undefined) return;
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const plan = planSidebarThreadDrop({
      activeKey,
      activeSection,
      activePinned: activeThread.pinnedAt != null,
      activeSettled: activeThread.settledOverride === "settled",
      supportsSettlement:
        serverConfigs.get(activeThread.environmentId)?.environment.capabilities.threadSettlement ===
        true,
      target,
      pinnedOrder:
        target.section === "pinned"
          ? (String(event.over?.id).startsWith("sidebar-destination:")
              ? pinnedDestinationKeys
              : pinnedKeys
            ).filter(
              (key) =>
                (pinnedSectionIdByThreadKey.get(key) ?? null) === (target.pinnedSectionId ?? null),
            )
          : pinnedKeys,
      pinnedKeysById,
      reorderableKeys: draggableThreadKeys,
      activeOrder: activeKeys,
      activeKeysById,
      activeReorderableKeys: activeReorderableThreadKeys,
      activeTimeOrdered: workingShelfEnabled,
    });
    if (plan.kind === "blocked") return;
    if (plan.kind === "none") {
      if (target.section === "pinned" && activeThread.pinnedAt != null)
        useUiStateStore
          .getState()
          .moveThreadsToPinnedSection([activeKey], target.pinnedSectionId ?? null);
      return;
    }
    if (plan.kind === "settle" && settlingThreadKeysRef.current.has(activeKey)) return;
    const dropThreadsByKey = new Map(
      threads.map((thread) => [threadShellKey(thread), thread] as const),
    );
    const assignments =
      plan.kind === "pin"
        ? [
            ...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]),
            ...plan.extraAssignments,
          ]
        : plan.kind === "reorder-pinned" || plan.kind === "move-active"
          ? plan.assignments
          : [];
    if (
      !checkThreadOperations(
        [activeKey, ...assignments.map(({ id }) => id)].flatMap((key) => {
          const thread = dropThreadsByKey.get(key);
          return thread ? [thread] : [];
        }),
      )
    )
      return;
    const drop = {
      key: activeKey,
      ...(target.section === "pinned" ? { pinnedSectionId: target.pinnedSectionId ?? null } : {}),
      sourceSection: activeSection,
      section: target.section,
      occurredAt: new Date().toISOString(),
      clearsSnooze:
        plan.kind === "pin" ||
        plan.kind === "settle" ||
        (plan.kind === "move-active" && plan.unsnooze),
      order:
        plan.kind === "settle" || plan.order === null
          ? null
          : plan.order.filter((key) => threadByKey.has(key)),
      keysAtDrop: target.section === "active" ? activeKeysById : pinnedKeysById,
      assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
    };
    setOptimisticDrop(drop);
    void (async () => {
      const run = async (
        operation: Promise<AtomCommandResult<unknown, unknown>>,
        title: string,
      ) => {
        const result = await operation;
        if (result._tag === "Success") return true;
        setOptimisticDrop((current) => (current === drop ? null : current));
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      };
      switch (plan.kind) {
        case "settle": {
          settlingThreadKeysRef.current.add(activeKey);
          const navigateAfterSettle = planForwardNavigation(activeKey);
          const settled = await run(settleThread(threadRef), "Failed to settle thread").finally(
            () => settlingThreadKeysRef.current.delete(activeKey),
          );
          if (
            settled &&
            shouldNavigateAfterThreadPark({
              threadKey: activeKey,
              currentThreadKey: routeThreadKeyRef.current,
              action: "settle",
              now: new Date().toISOString(),
              thread: readThreadShell(threadRef),
            })
          )
            navigateAfterSettle?.();
          return;
        }
        case "move-active":
          if (plan.unpin && !(await run(unpinThread(threadRef), "Failed to unpin thread"))) return;
          if (
            plan.unsettle &&
            !(await run(unsettleThread(threadRef), "Failed to un-settle thread"))
          )
            return;
          if (plan.unsnooze && !(await run(unsnoozeThread(threadRef), "Failed to wake thread")))
            return;
          break;
        case "pin":
          if (
            !(await run(
              pinThread(threadRef, plan.orderKey === undefined ? {} : { orderKey: plan.orderKey }),
              "Failed to pin thread",
            ))
          )
            return;
          break;
        case "reorder-pinned":
          break;
      }
      const keyWrites = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
      for (const assignment of keyWrites) {
        const thread = dropThreadsByKey.get(assignment.id);
        if (thread === undefined) continue;
        if (
          !(await run(
            (plan.kind === "move-active" ? reorderActiveThread : reorderPinnedThread)(
              scopeThreadRef(thread.environmentId, thread.id),
              assignment.orderKey,
            ),
            plan.kind === "move-active"
              ? "Failed to reorder active threads"
              : "Failed to reorder pinned threads",
          ))
        )
          return;
      }
      if (target.section === "pinned")
        useUiStateStore
          .getState()
          .moveThreadsToPinnedSection([activeKey], target.pinnedSectionId ?? null);
    })();
  };
  const performSnooze = async (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    const threadKey = scopedThreadKey(threadRef);
    if (snoozingThreadKeysRef.current.has(threadKey)) {
      return { status: "skipped" } as const;
    }
    snoozingThreadKeysRef.current.add(threadKey);
    const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
    const result = await snoozeThread(threadRef, preset.snoozedUntil);
    snoozingThreadKeysRef.current.delete(threadKey);
    if (result._tag === "Failure") {
      return isAtomCommandInterrupted(result)
        ? ({ status: "interrupted" } as const)
        : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
    }
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: routeThreadKeyRef.current,
        action: "snooze",
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSnooze?.();
    }
    return { status: "success" } as const;
  };
  const attemptSnooze = (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const outcome = await performSnooze(threadRef, preset, opts);
      if (outcome.status === "failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to snooze thread",
            description:
              outcome.error instanceof Error ? outcome.error.message : "An error occurred.",
          }),
        );
        return;
      }
    })();
  };

  const handleMultiSelectContextMenu = useStableCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) =>
        threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const settlingThreads = selectedThreads.filter(
        (thread) => thread.settledOverride !== "settled",
      );
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true,
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const pinnedSelectedThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning ===
            true && thread.pinnedAt != null,
      );
      const unpinMenuItem = buildBulkUnpinContextMenuItem({
        pinnedCount: pinnedSelectedThreads.length,
      });
      const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(unpinMenuItem
              ? [{ ...unpinMenuItem, disabled: !canOperateThreads(pinnedSelectedThreads) }]
              : []),
            {
              id: "settle",
              label: `Settle (${count})`,
              disabled: settlingThreads.length === 0 || !canOperateThreads(settlingThreads),
            },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    disabled: !canOperateThreads(selectedThreads),
                    children: [
                      ...snoozePresets.map((preset) => ({
                        id: `snooze:${preset.id}`,
                        label: `${preset.label} (${preset.whenLabel})`,
                        disabled: !canOperateThreads(selectedThreads),
                      })),
                      {
                        id: "snooze:custom",
                        label: "Custom…",
                        separatorBefore: true,
                        disabled: !canOperateThreads(selectedThreads),
                      },
                    ],
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem
              ? [
                  {
                    ...titleRegenerationMenuItem,
                    disabled:
                      titleRegenerationMenuItem.disabled ||
                      !canOperateThreads(regeneratableTitleThreads),
                  },
                ]
              : []),
            ...pinnedSectionMenuItems(threadKeys),
            { id: "mark-unread", label: `Mark unread (${count})` },
            {
              id: "delete",
              label: `Delete (${count})`,
              destructive: true,
              disabled: !canOperateThreads(selectedThreads),
            },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure" || clicked.value === null) return;
      if (
        await handlePinnedSectionAction(
          clicked.value,
          selectedThreads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
        )
      )
        return;
      const actionTargets =
        clicked.value === "unpin"
          ? pinnedSelectedThreads
          : clicked.value === "regenerate-title"
            ? regeneratableTitleThreads
            : clicked.value === "settle"
              ? settlingThreads.flatMap((thread) => {
                  const current = threadByKeyRef.current.get(
                    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                  );
                  return current && current.settledOverride !== "settled" ? [current] : [];
                })
              : selectedThreads;
      if (clicked.value === "settle" && actionTargets.length === 0) return;
      if (clicked.value !== "mark-unread" && !checkThreadOperations(actionTargets)) return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset =
          clicked.value === "snooze:custom"
            ? await requestCustomSnooze()
            : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
        if (preset) {
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, { coSnoozingKeys });
              return { outcome, threadRef };
            }),
          );
          const snoozedThreadRefs = outcomes.flatMap(({ outcome, threadRef }) =>
            outcome.status === "success" ? [threadRef] : [],
          );
          const failures = outcomes.flatMap(({ outcome }) =>
            outcome.status === "failure" ? [outcome.error] : [],
          );

          if (failures.length > 0) {
            const firstError = failures[0];
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title:
                  snoozedThreadRefs.length > 0
                    ? `Failed to snooze ${failures.length} thread${failures.length === 1 ? "" : "s"}`
                    : "Failed to snooze threads",
                description:
                  firstError instanceof Error ? firstError.message : "An error occurred.",
              }),
            );
          }
        }
        return;
      }
      if (clicked.value === "unpin") {
        for (const thread of pinnedSelectedThreads) {
          attemptUnpin(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value === "regenerate-title") {
        for (const thread of regeneratableTitleThreads) {
          const result = await updateThreadMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, regenerateTitle: true },
          });
          if (result._tag === "Success") continue;
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread titles",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        clearSelection();
        return;
      }
      if (clicked.value === "settle") {
        settleThreads(
          actionTargets.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        );
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (thread) markThreadUnread(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            [
              `Delete ${count} thread${count === 1 ? "" : "s"}?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      if (
        !checkThreadOperations(
          threadKeys.flatMap((threadKey) => {
            const thread = threadByKeyRef.current.get(threadKey);
            return thread ? [thread] : [];
          }),
        )
      )
        return;
      const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
        entries: threadKeys.map((threadKey) => ({ threadKey })),
        delete: async ({ threadKey }, deletedThreadKeys) => {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread) return null;
          return deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
          });
        },
      });
      if (firstFailure !== null) {
        const firstError = squashAtomCommandFailure(firstFailure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete threads",
            description: firstError instanceof Error ? firstError.message : "An error occurred.",
          }),
        );
      }
      removeFromSelection(
        getThreadKeysToDeselectAfterDelete(selectedThreadKeys, deletedThreadKeys, (threadKey) => {
          const threadRef = parseScopedThreadKey(threadKey);
          return threadRef !== null && readThreadShell(threadRef) !== null;
        }),
      );
    },
  );

  const handleDraftContextMenu = useStableCallback(
    (draftId: DraftId, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        if (!api || !session || session.promotedTo) return;
        const projectGroup = projectGroupsRef.current.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === session.environmentId && ref.projectId === session.projectId,
          ),
        );
        const workspacePath =
          session.worktreePath ??
          projectByKey.get(`${session.environmentId}:${session.projectId}`)?.workspaceRoot;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildDraftActionMenuItems({
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: projectGroup != null,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "project-settings":
            if (projectGroup)
              openProjectSettings(projectGroup, {
                environmentId: session.environmentId,
                projectId: session.projectId,
              });
            return;
          case "copy-path":
            if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          case "copy-branch":
            if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
            return;
          case "discard": {
            // The menu can stay open while the draft sends; discarding a
            // promoting draft would strand the send.
            const current = useComposerDraftStore.getState().getDraftSession(draftId);
            if (current && !current.promotedTo) discardComposerDraft(draftId);
            return;
          }
        }
      })();
    },
  );

  const handleThreadContextMenu = useStableCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
          null;
        const supportsSettlement =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
          true;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const supportsPinning =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning === true;
        const supportsAutoSettleOptOut =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadAutoSettleOptOut === true;
        const supportsTitleRegeneration =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        const isPinned = thread.pinnedAt != null;
        const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
        const threadProjectGroup =
          projectGroupsRef.current.find((project) =>
            project.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === thread.environmentId &&
                projectRef.projectId === thread.projectId,
            ),
          ) ?? null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              ...buildThreadActionMenuItems({
                canOperate: readEnvironmentScope(
                  threadRef.environmentId,
                  AuthOrchestrationOperateScope,
                ),
                branch: thread.branch ?? null,
                projectFilter: threadProjectGroup
                  ? {
                      label: threadProjectGroup.displayName,
                      isActive: projectScopeKey === threadProjectGroup.projectKey,
                    }
                  : null,
                isPinned,
                isSettled,
                autoSettleEnabled: thread.autoSettleDisabledAt == null,
                prBadgeHidden:
                  useUiStateStore.getState().threadPrBadgeHiddenById[threadKey] === true,
                isSnoozed,
                canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
                isRegeneratingTitle,
                isRunning: !threadRuntimeCanArchive(thread.runtime),
                supports: {
                  settlement: supportsSettlement,
                  autoSettleOptOut: supportsAutoSettleOptOut,
                  snooze: supportsSnooze,
                  pinning: supportsPinning,
                  titleRegeneration: supportsTitleRegeneration,
                },
                snoozePresets,
              }),
              ...pinnedSectionMenuItems([threadKey]),
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        if (await handlePinnedSectionAction(clicked.value, [threadRef])) return;
        if (threadActionRequiresOperate(clicked.value) && !checkThreadOperations([thread])) return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset =
            clicked.value === "snooze:custom"
              ? await requestCustomSnooze()
              : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "pr-badge:visible":
          case "pr-badge:hidden":
            useUiStateStore
              .getState()
              .setThreadPrBadgeHidden(threadKey, clicked.value === "pr-badge:hidden");
            return;
          case "filter-by-project":
            if (threadProjectGroup) {
              setProjectScopeKey(
                projectScopeKey === threadProjectGroup.projectKey
                  ? null
                  : threadProjectGroup.projectKey,
              );
            }
            return;
          case "project-settings":
            if (threadProjectGroup)
              openProjectSettings(threadProjectGroup, {
                environmentId: threadRef.environmentId,
                projectId: thread.projectId,
              });
            return;
          case "new-thread-on-branch": {
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "settle":
            attemptSettle(threadRef);
            return;
          case "unsettle":
            attemptUnsettle(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "pin":
            attemptPin(threadRef);
            return;
          case "unpin":
            attemptUnpin(threadRef);
            return;
          case "auto-settle:enabled":
          case "auto-settle:disabled": {
            const result = await setThreadAutoSettle(
              threadRef,
              clicked.value === "auto-settle:enabled",
            );
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to update auto-settle",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "regenerate-title": {
            if (isRegeneratingTitle) return;
            const result = await updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to regenerate thread title",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "mark-unread":
            markThreadUnread(threadRef);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "archive": {
            if (confirmThreadArchive) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(`Archive thread "${thread.title}"?`),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            let didArchive = false;
            const result = await archiveThread(threadRef, {
              onArchived: () => {
                didArchive = true;
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: didArchive
                    ? "Thread archived, but navigation failed"
                    : "Failed to archive thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    `Delete thread "${thread.title}"?`,
                    "This permanently clears conversation history for this thread.",
                  ].join("\n"),
                  { variant: "destructive" },
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
  );

  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
          isWeb: !isElectron,
          isDesktop: isElectron,
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeRowThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const pinnedIndex = threadPinnedIndexFromCommand(command ?? "");
      if (pinnedIndex !== null) {
        const target = pinnedThreads[pinnedIndex];
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          navigateToThread(scopeThreadRef(target.environmentId, target.id));
        }
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      const direction = threadTraversalDirectionFromCommand(action);
      if (direction !== null) {
        const targetKey = resolveAdjacentThreadId({
          threadIds: orderedThreadKeys,
          currentThreadId: routeRowThreadKey,
          direction,
        });
        const target = targetKey ? threadByKey.get(targetKey) : undefined;
        if (target) navigateToThread(scopeThreadRef(target.environmentId, target.id));
        return;
      }
      const pinnedIndex = threadPinnedIndexFromCommand(action);
      if (pinnedIndex !== null) {
        const target = pinnedThreads[pinnedIndex];
        if (target) navigateToThread(scopeThreadRef(target.environmentId, target.id));
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(action);
      const targetKey = jumpIndex === null ? null : (orderedThreadKeys[jumpIndex] ?? null);
      const target = targetKey ? threadByKey.get(targetKey) : undefined;
      if (target) navigateToThread(scopeThreadRef(target.environmentId, target.id));
    });
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      unsubscribe?.();
    };
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    pinnedThreads,
    routeRowThreadKey,
    routeTerminalOpen,
    threadByKey,
  ]);

  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform: navigator.platform,
      context: {
        terminalFocus: terminalFocused,
        terminalOpen: routeTerminalOpen,
        modelPickerOpen: isModelPickerOpen(),
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    },
  );
  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow, updateThreadJumpHintsVisibility]);

  const handleNewThreadClick = (event?: ReactMouseEvent) => {
    if (shouldCreateNewThreadInCurrentProject(event?.shiftKey ?? false, projectGroups.length)) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  };

  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (projectGroups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : undefined);
  const newThreadInProjectShortcutLabel = shortcutLabelForCommand(keybindings, "chat.newLocal");
  return (
    <>
      <PinnedSectionDialogHost />
      <ThreadContextDragGhost />
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              searchFieldRef={headerSearchRef}
              hasProjects={projectGroups.length > 0}
              projectScope={
                <Combobox
                  items={projectScopeItems}
                  filteredItems={filteredProjectScopeItems}
                  autoHighlight
                  itemToStringLabel={(item) => item.label}
                  isItemEqualToValue={(a, b) => a.value === b.value}
                  open={projectScopeMenuState.open}
                  onOpenChange={(open) => {
                    if (open) suppressNextScopeChangeRef.current = false;
                    dispatchProjectScopeMenu({ type: "open-changed", open });
                  }}
                  onItemHighlighted={(item) => {
                    highlightedProjectScopeKeyRef.current = item?.value ?? null;
                  }}
                  value={selectedProjectScopeItem}
                  onValueChange={(item) => {
                    if (suppressNextScopeChangeRef.current) {
                      suppressNextScopeChangeRef.current = false;
                      return;
                    }
                    if (!item) return;
                    setProjectScopeKey(item.value === "all" ? null : item.value);
                  }}
                >
                  <ComboboxTrigger
                    render={
                      <SidebarHeaderIconButton
                        label={
                          scopedProjectGroup
                            ? `Filter threads by project: ${scopedProjectGroup.displayName}`
                            : "Filter threads by project"
                        }
                      />
                    }
                  >
                    {scopedProjectGroup ? (
                      <span className="flex shrink-0">
                        <ProjectFavicon project={scopedProjectGroup} className="size-4" />
                      </span>
                    ) : (
                      <ListFilterIcon className="size-4" />
                    )}
                  </ComboboxTrigger>
                  <ComboboxPopup
                    align="start"
                    anchor={headerSearchRef}
                    className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
                  >
                    <ComboboxSearchInput
                      aria-label="Search projects"
                      placeholder="Search projects..."
                      value={projectScopeMenuState.query}
                      onKeyDown={(event) => {
                        if (
                          event.defaultPrevented ||
                          event.nativeEvent.isComposing ||
                          event.ctrlKey ||
                          event.altKey ||
                          event.metaKey ||
                          (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                        ) {
                          return;
                        }
                        const scopeKey = highlightedProjectScopeKeyRef.current;
                        const project = scopeKey ? projectGroupByScopeKey.get(scopeKey) : null;
                        if (project) handleProjectSettings(event, project);
                      }}
                      onChange={(event) =>
                        dispatchProjectScopeMenu({
                          type: "query-changed",
                          query: event.target.value,
                        })
                      }
                    />
                    <ComboboxEmpty>No matching projects.</ComboboxEmpty>
                    <ComboboxList>
                      {(item: (typeof projectScopeItems)[number]) => {
                        const project = projectGroupByScopeKey.get(item.value) ?? null;
                        return (
                          <ComboboxItem
                            key={item.value}
                            hideIndicator
                            value={item}
                            onContextMenu={(event) => {
                              if (project) handleProjectSettings(event, project);
                            }}
                          >
                            {project ? (
                              <ProjectFavicon project={project} className="size-4 shrink-0" />
                            ) : (
                              <FolderIcon className="size-4 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                            {project && showProjectEnvironments ? (
                              <ProjectEnvironmentBadge
                                group={project}
                                primaryEnvironmentId={primaryEnvironmentId}
                                machineByEnvironmentId={environmentMachineById}
                              />
                            ) : null}
                            {project ? (
                              <Button
                                size="icon-xs"
                                variant="ghost-muted"
                                tabIndex={-1}
                                aria-hidden="true"
                                title={`Project settings for ${project.displayName}`}
                                className="ml-auto"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  void handleProjectSettings(event, project);
                                }}
                              >
                                <SettingsIcon className="size-3.5" />
                              </Button>
                            ) : null}
                          </ComboboxItem>
                        );
                      }}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              }
              onNewProject={openAddProjectCommandPalette}
              onNewThread={handleNewThreadClick}
              newThreadDisabled={projects.length === 0}
              newThreadShortcutLabel={newThreadShortcutLabel}
              newThreadInProjectShortcutLabel={newThreadInProjectShortcutLabel}
              showNewThreadInProjectHint={projectGroups.length > 1}
              searchInputRef={threadSearchInputRef}
              searchQuery={threadSearchQuery}
              onSearchQueryChange={(value) => {
                setThreadSearchQuery(value);
                setActiveSearchResultIndex(0);
              }}
              onSearchKeyDown={handleThreadSearchKeyDown}
              isSearching={isSearchingThreads}
              searchResultCount={threadSearchResults.length}
              activeSearchResultIndex={activeSearchResultIndex}
              onClearSearch={clearThreadSearch}
            />
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          {isSearchingThreads ? (
            threadSearchResults.length > 0 ? (
              <TooltipProvider
                key="sidebar-thread-search-tooltips-150"
                delay={150}
                closeDelay={0}
                timeout={400}
              >
                <ul
                  id="sidebar-thread-search-results"
                  role="listbox"
                  aria-label="Thread search results"
                  className="flex flex-col gap-px"
                >
                  {threadSearchResults.map((thread, index) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    return (
                      <SidebarSearchResultRow
                        isSettled={settledThreadKeys.has(threadKey)}
                        key={threadKey}
                        thread={thread}
                        project={
                          projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectDisplayName={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        environmentMachine={
                          environmentMachineById.get(thread.environmentId) ?? "server"
                        }
                        providerEntryByInstanceId={
                          providerEntriesByEnvironment.get(thread.environmentId) ??
                          EMPTY_PROVIDER_ENTRIES
                        }
                        isHighlighted={activeSearchResultIndex === index}
                        isRouteActive={routeRowThreadKey === threadKey}
                        resultId={`sidebar-thread-search-result-${index}`}
                        searchMatch={
                          threadSearchMatchByKey.get(
                            threadSearchMatchKey({
                              environmentId: thread.environmentId,
                              threadId: thread.id,
                            }),
                          ) ?? null
                        }
                        searchQuery={threadSearchQuery}
                        onHighlight={() => setActiveSearchResultIndex(index)}
                        onSelect={() => selectThreadSearchResult(thread)}
                        onFileDropThreads={handleThreadFileDrop}
                      />
                    );
                  })}
                </ul>
              </TooltipProvider>
            ) : (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                {threadSearch.isPending ? "Searching thread messages…" : "No threads found"}
              </p>
            )
          ) : null}
          {!isSearchingThreads ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <DndContext
                sensors={dndSensors}
                autoScroll={{
                  enabled: organizingDrag,
                  layoutShiftCompensation: false,
                  canScroll: (element) =>
                    !isContextDrag && canAutoScrollSidebarSource(element, dragPointerYRef.current),
                  threshold: { x: 0, y: 0.12 },
                }}
                measuring={{
                  droppable: {
                    strategy: MeasuringStrategy.Always,
                    measure: measureSidebarDropTarget,
                  },
                }}
                collisionDetection={dndCollisionDetection}
                modifiers={dndModifiers}
                onDragStart={handleThreadDragStart}
                onDragEnd={handleThreadDragEnd}
              >
                <SidebarDragLifecycle onUnmount={cancelThreadDrag} />
                <SidebarDragLayout layout={dragLayout} listRef={threadListRef} />
                <div
                  className={cn(
                    "relative flex min-h-0 flex-col",
                    (threads.length > 0 || visibleDraftSessionCount > 0) && "flex-1",
                  )}
                >
                  <SidebarSourceSort order={sourceReorderEnabled ? sourceOrder : []}>
                    <SortableContext
                      items={sortableIds}
                      strategy={stationarySidebarSortingStrategy}
                    >
                      <ul
                        ref={attachListMotionRef}
                        // VoiceOver treats an exposed list as an interaction boundary,
                        // which hides its rows from ordinary linear navigation. A
                        // presentational list also makes its implicit listitems
                        // presentational while preserving every descendant control.
                        role="presentation"
                        data-sidebar-drag-list={organizingDrag || undefined}
                        style={
                          organizingDrag
                            ? {
                                position: "fixed",
                                top: dragState.dropBounds.top,
                                left: dragState.dropBounds.left,
                                width: dragState.dropBounds.width,
                                height: dragState.dropBounds.height,
                              }
                            : undefined
                        }
                        className={cn(
                          "relative flex flex-col gap-px",
                          organizingDrag && "gap-2 overflow-y-auto py-2 [overflow-anchor:none]",
                          sidebarListItems.length > 0 && "flex-1",
                          actionSweep !== null && "**:pointer-events-none",
                        )}
                      >
                        {(() => {
                          const renderThreadRow = (
                            thread: EnvironmentThreadShell,
                            section: SidebarSection,
                          ) => {
                            const threadKey = scopedThreadKey(
                              scopeThreadRef(thread.environmentId, thread.id),
                            );
                            const pinnedSection =
                              section === "pinned"
                                ? namedPinnedSections.find((entry) =>
                                    entry.section.threadKeys.includes(threadKey),
                                  )?.section
                                : undefined;
                            const sectionKey = pinnedSection
                              ? `pinned-section:${pinnedSection.id}`
                              : section;
                            const isCard = !compactSections[sectionKey];
                            const rowVariant =
                              isCard && !(mixedDrag && threadKey === dragState.activeKey)
                                ? "card"
                                : "slim";
                            return (
                              <DraggableThreadRow
                                key={threadKey}
                                draggableId={threadKey}
                                contextDrag={isContextDrag}
                                floatingDuringDrag={mixedDrag && !sourceIsList}
                                sidebarDragging={dragState !== null}
                                dragSlotHeight={
                                  organizingDrag && threadKey === dragState.activeKey
                                    ? dragState.sourceRowHeight
                                    : undefined
                                }
                                dragOverlay={organizingDrag ? dragState.dropBounds : undefined}
                                draggableDisabled={
                                  renamingThreadKey === threadKey ||
                                  !draggableThreadKeys.has(threadKey) ||
                                  optimisticDrop !== null
                                }
                                thread={thread}
                                variant={rowVariant}
                                variantAction={
                                  section === "snoozed"
                                    ? "unsnooze"
                                    : section === "settled"
                                      ? "unsettle"
                                      : "settle"
                                }
                                settlementSupported={
                                  serverConfigs.get(thread.environmentId)?.environment.capabilities
                                    .threadSettlement === true
                                }
                                snoozeSupported={
                                  serverConfigs.get(thread.environmentId)?.environment.capabilities
                                    .threadSnooze === true
                                }
                                sweepAction={
                                  actionSweep?.keys.has(threadKey) ? actionSweep.action : null
                                }
                                snoozeWakeLabelText={
                                  section === "snoozed" && thread.snoozedUntil != null
                                    ? snoozeWakeLabel(thread.snoozedUntil, {
                                        now: new Date().toISOString(),
                                      })
                                    : null
                                }
                                wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                                isActive={routeRowThreadKey === threadKey}
                                isRouteThread={routeThreadKey === threadKey}
                                openPullRequestsInRightPanel={routeThreadRef !== null}
                                jumpLabel={
                                  showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null
                                }
                                currentEnvironmentId={primaryEnvironmentId}
                                environmentLabel={
                                  environmentLabelById.get(thread.environmentId) ?? null
                                }
                                environmentMachine={
                                  environmentMachineById.get(thread.environmentId) ?? "server"
                                }
                                scratchMachineLabel={scratchMachineLabelFor(thread)}
                                project={
                                  projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
                                  null
                                }
                                projectDisplayName={
                                  projectDisplayNameByKey.get(
                                    `${thread.environmentId}:${thread.projectId}`,
                                  ) ?? null
                                }
                                providerEntryByInstanceId={
                                  providerEntriesByEnvironment.get(thread.environmentId) ??
                                  EMPTY_PROVIDER_ENTRIES
                                }
                                timestampFormat={timestampFormat}
                                onThreadClick={handleThreadClick}
                                onThreadActivate={navigateToThread}
                                onStartRename={startThreadRename}
                                onRenameTitleChange={setRenamingTitle}
                                onCommitRename={commitThreadRename}
                                onCancelRename={cancelThreadRename}
                                isRenaming={renamingThreadKey === threadKey}
                                renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                                onContextMenu={handleThreadContextMenu}
                                onSettle={attemptSettle}
                                onActionSweepStart={startActionSweep}
                                onUnsettle={attemptUnsettle}
                                onSnooze={attemptSnooze}
                                onUnsnooze={attemptUnsnooze}
                                onAcknowledgeWoke={acknowledgeWoke}
                                onFileDropThreads={handleThreadFileDrop}
                              />
                            );
                          };
                          const items: ReactNode[] = organizingDrag
                            ? []
                            : [
                                <SidebarDraftBlock
                                  key="draft-sessions"
                                  projectByKey={projectByKey}
                                  projectDisplayNameByKey={projectDisplayNameByKey}
                                  scopedProjectKeys={scopedProjectKeys}
                                  routeDraftId={routeDraftIdForRows}
                                  onNavigateToDraft={navigateToDraft}
                                  onDraftContextMenu={handleDraftContextMenu}
                                />,
                              ];
                          let threadGroup: { key: string; rows: ReactNode[] } | undefined;
                          for (const item of sidebarListItems) {
                            if (organizingDrag) {
                              if (item.kind === "thread" && !sourceKeys.has(item.key)) continue;
                              if (item.kind === "marker") {
                                const section =
                                  item.marker === "pinned-header" ||
                                  item.marker.startsWith("pinned-section:")
                                    ? "pinned"
                                    : item.marker === "pinned-divider"
                                      ? "active"
                                      : item.marker === "settled-header"
                                        ? "settled"
                                        : item.marker === "snoozed-header"
                                          ? "snoozed"
                                          : item.marker === "working-header"
                                            ? "working"
                                            : null;
                                if (section === null) continue;
                                const pinnedSectionId = item.marker.startsWith("pinned-section:")
                                  ? item.marker.slice("pinned-section:".length)
                                  : null;
                                const isSource =
                                  section === dragState.activeSection &&
                                  (section !== "pinned" ||
                                    pinnedSectionId === dragState.pinnedSectionId);
                                const destination = dropDestinations.find(
                                  (entry) =>
                                    section !== "snoozed" &&
                                    section !== "working" &&
                                    entry.id === sidebarDestinationId(section, pinnedSectionId),
                                );
                                if (!isSource || !sourceIsList) {
                                  if (destination)
                                    items.push(
                                      <li
                                        key={item.marker}
                                        data-sidebar-marker={item.marker}
                                        className={cn(
                                          "relative list-none",
                                          section === "active" && "min-h-9 flex-1",
                                          destination.size === "half" &&
                                            "sticky bottom-2 z-10 mt-auto border-t-8 border-transparent",
                                          destination.size === "half"
                                            ? "h-26 min-h-11 shrink"
                                            : section === "pinned"
                                              ? "h-16 shrink-0"
                                              : "h-9 shrink-0",
                                        )}
                                      >
                                        <SidebarDropBox
                                          destination={destination}
                                          align={section === "pinned" ? "start" : "center"}
                                        />
                                      </li>,
                                    );
                                  continue;
                                }
                                const count =
                                  destination?.count ??
                                  (section === "snoozed" ? snoozedThreads.length : undefined);
                                items.push(
                                  <li
                                    key={item.marker}
                                    data-sidebar-marker={item.marker}
                                    data-sidebar-source
                                    className={cn(
                                      "shrink-0 list-none",
                                      section === "settled" && "mt-auto",
                                    )}
                                  >
                                    <div className="flex h-8 min-w-0 items-center px-2 text-sm leading-5 font-medium text-sidebar-foreground">
                                      <span className="truncate">
                                        {destination?.label ?? "Snoozed"}
                                        {count === undefined ? null : ` (${count})`}
                                      </span>
                                    </div>
                                  </li>,
                                );
                                continue;
                              }
                            }
                            if (item.kind === "thread") {
                              const key = `${item.section}:${item.pinnedSectionId ?? ""}`;
                              if (threadGroup?.key !== key) {
                                threadGroup = { key, rows: [] };
                                const source = organizingDrag && sourceKeys.has(item.key);
                                items.push(
                                  <SidebarSourceList
                                    key={`threads:${key}`}
                                    source={source}
                                    fill={item.section === "active"}
                                  >
                                    <ul
                                      role="presentation"
                                      className={
                                        source
                                          ? "relative flex flex-col gap-2 [&>li]:shrink-0"
                                          : "contents"
                                      }
                                    >
                                      {threadGroup.rows}
                                    </ul>
                                  </SidebarSourceList>,
                                );
                              }
                              threadGroup.rows.push(
                                renderThreadRow(threadByKey.get(item.key)!, item.section),
                              );
                              continue;
                            }
                            if (item.marker.startsWith("pinned-section:")) {
                              const sectionId = item.marker.slice("pinned-section:".length);
                              const entry = namedPinnedSections.find(
                                ({ section }) => section.id === sectionId,
                              );
                              if (entry)
                                items.push(
                                  <SortableSidebarMarker key={item.marker} marker={item.marker}>
                                    <SidebarThreadSectionHeader
                                      section={entry.section}
                                      count={entry.threads.length}
                                    />
                                  </SortableSidebarMarker>,
                                );
                              continue;
                            }
                            switch (item.marker) {
                              case "pinned-header":
                                items.push(
                                  <SortableSidebarMarker
                                    key="pinned-header"
                                    marker="pinned-header"
                                    data-testid="sidebar-pinned-header"
                                  >
                                    <SidebarThreadSectionHeader
                                      section={null}
                                      count={defaultPinnedThreads.length}
                                      expanded={pinnedShelfExpanded}
                                      onToggle={togglePinnedShelf}
                                    />
                                  </SortableSidebarMarker>,
                                );
                                break;
                              case "pinned-divider":
                                items.push(
                                  <SidebarDragBoundary
                                    key="pinned-divider"
                                    marker="pinned-divider"
                                    count={activeThreads.length}
                                  />,
                                );
                                break;
                              case "active-placeholder":
                                items.push(
                                  <SidebarSectionPlaceholder
                                    key="active-placeholder"
                                    marker="active-placeholder"
                                  />,
                                );
                                break;
                              case "working-header":
                                items.push(
                                  <SidebarSectionHeader
                                    key="working-shelf-header"
                                    marker="working-header"
                                    className="mt-auto"
                                    count={workingThreads.length}
                                    toggle={{
                                      expanded: workingShelfExpanded,
                                      onToggle: toggleWorkingShelf,
                                    }}
                                  />,
                                );
                                break;
                              case "snoozed-header":
                                items.push(
                                  <SidebarSectionHeader
                                    key="snoozed-shelf-header"
                                    marker="snoozed-header"
                                    className={cn(workingThreads.length === 0 && "mt-auto")}
                                    count={snoozedThreads.length}
                                    toggle={{
                                      expanded: snoozedShelfExpanded,
                                      onToggle: toggleSnoozedShelf,
                                    }}
                                  />,
                                );
                                break;
                              case "settled-header":
                                items.push(
                                  <SidebarSectionHeader
                                    key="settled-shelf-header"
                                    marker="settled-header"
                                    className={cn(
                                      "sticky bottom-0 z-10 h-11 shrink-0 bg-sidebar surface-grain pb-3",
                                      "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-[var(--fade-size)] before:bg-sidebar before:surface-grain before:mask-t-from-0",
                                      workingThreads.length + snoozedThreads.length === 0 &&
                                        "mt-auto",
                                    )}
                                    count={settledThreads.length}
                                    toggle={{
                                      expanded: settledShelfExpanded,
                                      onToggle: toggleSettledShelf,
                                    }}
                                  />,
                                );
                                break;
                              case "settled-placeholder":
                                items.push(
                                  <SidebarSectionPlaceholder
                                    key="settled-placeholder"
                                    marker="settled-placeholder"
                                  />,
                                );
                                break;
                            }
                          }
                          return items;
                        })()}
                        {!organizingDrag && settledShelfExpanded && hiddenSettledCount > 0 ? (
                          <li className="list-none">
                            <button
                              type="button"
                              onClick={showMoreSettled}
                              className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                            >
                              <PlusIcon aria-hidden className="size-4 shrink-0" />
                              Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    </SortableContext>
                  </SidebarSourceSort>
                </div>
              </DndContext>
            </TooltipProvider>
          ) : null}
          {!isSearchingThreads &&
          visibleDraftSessionCount === 0 &&
          namedPinnedSections.length === 0 &&
          pinnedThreads.length +
            activeThreads.length +
            workingThreads.length +
            snoozedThreads.length +
            settledThreads.length ===
            0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
