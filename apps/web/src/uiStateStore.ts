import { Debouncer } from "@tanstack/react-pacer";
import type { PullRequestMergeMethod } from "@t3tools/contracts";
import { create } from "zustand";
import { normalizeProjectPathForComparison } from "./lib/projectPaths";
import { randomUUID } from "./lib/utils";

export const PERSISTED_STATE_KEY = "t3code:ui-state:v1";
export const MAX_SIDEBAR_PINNED_SECTIONS = 20;
export const MAX_SIDEBAR_SECTION_NAME_LENGTH = 64;

export interface SidebarPinnedSection {
  id: string;
  name: string;
  threadKeys: string[];
  collapsed: boolean;
}

const THREAD_CHANGED_FILES_EXPANSION_VERSION = 2;
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export interface PersistedUiState {
  projectExpandedById?: Record<string, boolean>;
  projectOrder?: string[];
  threadLastVisitedAtById?: Record<string, string>;
  threadPrBadgeHiddenById?: Record<string, boolean>;
  collapsedProjectCwds?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  defaultAdvertisedEndpointKey?: string | null;
  sidebarProjectScopeKey?: string | null;
  sidebarPinnedSections?: SidebarPinnedSection[];
  sidebarCompactSections?: Record<string, boolean>;
  threadChangedFilesExpansionVersion?: number;
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
  pullRequestMergeMethod?: string;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
  sidebarProjectScopeKey: string | null;
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadPrBadgeHiddenById: Record<string, boolean>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
}

export interface UiEndpointState {
  defaultAdvertisedEndpointKey: string | null;
}

export interface UiPullRequestState {
  pullRequestMergeMethod: PullRequestMergeMethod;
}

export interface UiState
  extends UiProjectState, UiThreadState, UiEndpointState, UiPullRequestState {
  sidebarPinnedSections: SidebarPinnedSection[];
  sidebarCompactSections: Record<string, boolean>;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  sidebarProjectScopeKey: null,
  sidebarPinnedSections: [],
  sidebarCompactSections: { snoozed: true, settled: true },
  threadLastVisitedAtById: {},
  threadPrBadgeHiddenById: {},
  threadChangedFilesExpandedById: {},
  defaultAdvertisedEndpointKey: null,
  pullRequestMergeMethod: "merge",
};

const LEGACY_PROJECT_CWD_PREFERENCE_PREFIX = "legacy-project-cwd:";
const LEGACY_PROJECT_EXPANSION_DEFAULT_KEY = "legacy-project-expansion-default";
let legacyKeysCleanedUp = false;

export function legacyProjectCwdPreferenceKey(cwd: string): string {
  return `${LEGACY_PROJECT_CWD_PREFERENCE_PREFIX}${normalizeProjectPathForComparison(cwd)}`;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    ),
  ];
}

function sanitizeSidebarPinnedSections(value: unknown): SidebarPinnedSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sections: SidebarPinnedSection[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const threadKeys = new Set<string>();
  const entries: readonly unknown[] = value;
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const entry = candidate as Record<string, unknown>;
    const { id, name, collapsed } = entry;
    if (typeof id !== "string" || !id.trim() || typeof name !== "string") {
      continue;
    }
    const normalizedName = name.trim().slice(0, MAX_SIDEBAR_SECTION_NAME_LENGTH).trim();
    const nameKey = normalizedName.toLowerCase();
    if (!normalizedName || ids.has(id) || names.has(nameKey)) {
      continue;
    }
    ids.add(id);
    names.add(nameKey);
    sections.push({
      id,
      name: normalizedName,
      collapsed: collapsed === true,
      threadKeys: sanitizeStringArray(entry.threadKeys).filter((key) => {
        if (threadKeys.has(key)) {
          return false;
        }
        threadKeys.add(key);
        return true;
      }),
    });
    if (sections.length === MAX_SIDEBAR_PINNED_SECTIONS) {
      break;
    }
  }
  return sections;
}

function sanitizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => entry[0].length > 0 && typeof entry[1] === "boolean",
    ),
  );
}

function sanitizeOptionalKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeTimestampRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 &&
        typeof entry[1] === "string" &&
        entry[1].length > 0 &&
        Number.isFinite(Date.parse(entry[1])),
    ),
  );
}

function isPullRequestMergeMethod(value: unknown): value is PullRequestMergeMethod {
  return value === "merge" || value === "squash" || value === "rebase";
}

export function parsePersistedState(parsed: PersistedUiState): UiState {
  const projectExpandedById =
    parsed.projectExpandedById === undefined
      ? (() => {
          const migrated: Record<string, boolean> = {};
          const collapsedProjectCwds = sanitizeStringArray(parsed.collapsedProjectCwds);
          const expandedProjectCwds = sanitizeStringArray(parsed.expandedProjectCwds);
          for (const cwd of collapsedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = false;
          }
          for (const cwd of expandedProjectCwds) {
            migrated[legacyProjectCwdPreferenceKey(cwd)] = true;
          }
          if (!Array.isArray(parsed.collapsedProjectCwds) && expandedProjectCwds.length > 0) {
            migrated[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] = false;
          }
          return migrated;
        })()
      : sanitizeBooleanRecord(parsed.projectExpandedById);
  const projectOrder =
    parsed.projectOrder === undefined
      ? sanitizeStringArray(parsed.projectOrderCwds).map(legacyProjectCwdPreferenceKey)
      : sanitizeStringArray(parsed.projectOrder);

  const sidebarPinnedSections = sanitizeSidebarPinnedSections(parsed.sidebarPinnedSections);
  const sectionKeys = new Set([
    "pinned",
    "active",
    "working",
    "snoozed",
    "settled",
    ...sidebarPinnedSections.map((section) => `pinned-section:${section.id}`),
  ]);

  return {
    projectExpandedById,
    projectOrder,
    threadLastVisitedAtById: sanitizeTimestampRecord(parsed.threadLastVisitedAtById),
    threadPrBadgeHiddenById: sanitizeBooleanRecord(parsed.threadPrBadgeHiddenById),
    threadChangedFilesExpandedById:
      parsed.threadChangedFilesExpansionVersion === THREAD_CHANGED_FILES_EXPANSION_VERSION
        ? sanitizePersistedThreadChangedFilesExpanded(parsed.threadChangedFilesExpandedById)
        : {},
    defaultAdvertisedEndpointKey: sanitizeOptionalKey(parsed.defaultAdvertisedEndpointKey),
    sidebarProjectScopeKey: sanitizeOptionalKey(parsed.sidebarProjectScopeKey),
    sidebarPinnedSections,
    sidebarCompactSections: {
      ...initialState.sidebarCompactSections,
      ...Object.fromEntries(
        Object.entries(sanitizeBooleanRecord(parsed.sidebarCompactSections)).filter(([key]) =>
          sectionKeys.has(key),
        ),
      ),
    },
    pullRequestMergeMethod: isPullRequestMergeMethod(parsed.pullRequestMergeMethod)
      ? parsed.pullRequestMergeMethod
      : initialState.pullRequestMergeMethod,
  };
}

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        return parsePersistedState(JSON.parse(legacyRaw) as PersistedUiState);
      }
      return initialState;
    }
    return parsePersistedState(JSON.parse(raw) as PersistedUiState);
  } catch {
    return initialState;
  }
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean") {
        nextTurns[turnId] = expanded;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const projectExpandedById = Object.fromEntries(
      Object.entries(state.projectExpandedById).filter(
        ([key]) => key !== LEGACY_PROJECT_EXPANSION_DEFAULT_KEY,
      ),
    );
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        projectExpandedById,
        projectOrder: state.projectOrder,
        threadLastVisitedAtById: state.threadLastVisitedAtById,
        threadPrBadgeHiddenById: state.threadPrBadgeHiddenById,
        defaultAdvertisedEndpointKey: state.defaultAdvertisedEndpointKey,
        sidebarProjectScopeKey: state.sidebarProjectScopeKey,
        sidebarPinnedSections: state.sidebarPinnedSections,
        sidebarCompactSections: state.sidebarCompactSections,
        threadChangedFilesExpansionVersion: THREAD_CHANGED_FILES_EXPANSION_VERSION,
        threadChangedFilesExpandedById: state.threadChangedFilesExpandedById,
        pullRequestMergeMethod: state.pullRequestMergeMethod,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {}
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

export function markThreadVisited(state: UiState, threadId: string, visitedAt: string): UiState {
  const visitedAtMs = Date.parse(visitedAt);
  if (!Number.isFinite(visitedAtMs)) {
    return state;
  }
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: visitedAt,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  if (currentThreadState[turnId] === expanded) {
    return state;
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: expanded,
      },
    },
  };
}

export function setDefaultAdvertisedEndpointKey(state: UiState, key: string | null): UiState {
  const nextKey = key && key.length > 0 ? key : null;
  if (state.defaultAdvertisedEndpointKey === nextKey) {
    return state;
  }
  return {
    ...state,
    defaultAdvertisedEndpointKey: nextKey,
  };
}

export function setSidebarProjectScopeKey(state: UiState, projectKey: string | null): UiState {
  const nextKey = sanitizeOptionalKey(projectKey);
  if (state.sidebarProjectScopeKey === nextKey) {
    return state;
  }
  return {
    ...state,
    sidebarProjectScopeKey: nextKey,
  };
}

function validSidebarSectionName(state: UiState, name: string, exceptId?: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_SIDEBAR_SECTION_NAME_LENGTH &&
    !state.sidebarPinnedSections.some(
      (section) => section.id !== exceptId && section.name.toLowerCase() === trimmed.toLowerCase(),
    )
  );
}

export function createSidebarPinnedSection(state: UiState, id: string, name: string): UiState {
  if (
    state.sidebarPinnedSections.length >= MAX_SIDEBAR_PINNED_SECTIONS ||
    !id.trim() ||
    state.sidebarPinnedSections.some((section) => section.id === id) ||
    !validSidebarSectionName(state, name)
  ) {
    return state;
  }
  return {
    ...state,
    sidebarPinnedSections: [
      ...state.sidebarPinnedSections,
      { id, name: name.trim(), threadKeys: [], collapsed: false },
    ],
  };
}

export function renameSidebarPinnedSection(state: UiState, id: string, name: string): UiState {
  if (!validSidebarSectionName(state, name, id)) {
    return state;
  }
  const section = state.sidebarPinnedSections.find((section) => section.id === id);
  if (!section || section.name === name.trim()) {
    return state;
  }
  return {
    ...state,
    sidebarPinnedSections: state.sidebarPinnedSections.map((section) =>
      section.id === id ? { ...section, name: name.trim() } : section,
    ),
  };
}

export function deleteSidebarPinnedSection(state: UiState, id: string): UiState {
  const sidebarPinnedSections = state.sidebarPinnedSections.filter((section) => section.id !== id);
  return sidebarPinnedSections.length === state.sidebarPinnedSections.length
    ? state
    : {
        ...state,
        sidebarPinnedSections,
        sidebarCompactSections: Object.fromEntries(
          Object.entries(state.sidebarCompactSections).filter(
            ([key]) => key !== `pinned-section:${id}`,
          ),
        ),
      };
}

export function moveThreadsToPinnedSection(
  state: UiState,
  threadKeys: readonly string[],
  sectionId: string | null,
): UiState {
  if (
    sectionId !== null &&
    !state.sidebarPinnedSections.some((section) => section.id === sectionId)
  ) {
    return state;
  }
  const keys = new Set(threadKeys.filter((key) => key.length > 0));
  if (keys.size === 0) {
    return state;
  }
  let changed = false;
  const sidebarPinnedSections = state.sidebarPinnedSections.map((section) => {
    const nextKeys =
      section.id === sectionId
        ? [...new Set([...section.threadKeys, ...keys])]
        : section.threadKeys.filter((key) => !keys.has(key));
    if (nextKeys.length === section.threadKeys.length) {
      return section;
    }
    changed = true;
    return { ...section, threadKeys: nextKeys };
  });
  return changed ? { ...state, sidebarPinnedSections } : state;
}

export function setSidebarSectionCompact(
  state: UiState,
  sectionKey: string,
  compact: boolean,
): UiState {
  return {
    ...state,
    sidebarCompactSections: {
      ...state.sidebarCompactSections,
      [sectionKey]: compact,
    },
  };
}

export function setThreadPrBadgeHidden(
  state: UiState,
  threadKey: string,
  hidden: boolean,
): UiState {
  return {
    ...state,
    threadPrBadgeHiddenById: { ...state.threadPrBadgeHiddenById, [threadKey]: hidden },
  };
}

export function toggleSidebarPinnedSection(state: UiState, id: string): UiState {
  if (!state.sidebarPinnedSections.some((section) => section.id === id)) {
    return state;
  }
  return {
    ...state,
    sidebarPinnedSections: state.sidebarPinnedSections.map((section) =>
      section.id === id ? { ...section, collapsed: !section.collapsed } : section,
    ),
  };
}

export function moveSidebarPinnedSection(
  state: UiState,
  id: string,
  direction: "up" | "down",
): UiState {
  const index = state.sidebarPinnedSections.findIndex((section) => section.id === id);
  const targetIndex = index + (direction === "up" ? -1 : 1);
  if (index < 0 || targetIndex < 0 || targetIndex >= state.sidebarPinnedSections.length) {
    return state;
  }
  const sidebarPinnedSections = [...state.sidebarPinnedSections];
  [sidebarPinnedSections[index], sidebarPinnedSections[targetIndex]] = [
    sidebarPinnedSections[targetIndex]!,
    sidebarPinnedSections[index]!,
  ];
  return { ...state, sidebarPinnedSections };
}

function setPullRequestMergeMethod(state: UiState, method: PullRequestMergeMethod): UiState {
  return state.pullRequestMergeMethod === method
    ? state
    : { ...state, pullRequestMergeMethod: method };
}

export function resolveProjectExpanded(
  projectExpandedById: Readonly<Record<string, boolean>>,
  preferenceKeys: readonly string[],
): boolean {
  for (const key of preferenceKeys) {
    const expanded = projectExpandedById[key];
    if (expanded !== undefined) {
      return expanded;
    }
  }
  return projectExpandedById[LEGACY_PROJECT_EXPANSION_DEFAULT_KEY] ?? true;
}

export function setProjectExpanded(
  state: UiState,
  projectIds: string | readonly string[],
  expanded: boolean,
): UiState {
  const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
  const nextEntries = ids.filter((projectId) => state.projectExpandedById[projectId] !== expanded);
  if (nextEntries.length === 0) {
    return state;
  }
  const projectExpandedById = { ...state.projectExpandedById };
  for (const projectId of nextEntries) {
    projectExpandedById[projectId] = expanded;
  }
  return {
    ...state,
    projectExpandedById,
  };
}

export function reorderProjects(
  state: UiState,
  currentProjectOrder: readonly string[],
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = currentProjectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...currentProjectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  createSidebarPinnedSection: (name: string) => string | null;
  renameSidebarPinnedSection: (id: string, name: string) => boolean;
  deleteSidebarPinnedSection: (id: string) => void;
  moveThreadsToPinnedSection: (threadKeys: readonly string[], sectionId: string | null) => void;
  toggleSidebarPinnedSection: (id: string) => void;
  setSidebarSectionCompact: (sectionKey: string, compact: boolean) => void;
  setThreadPrBadgeHidden: (threadKey: string, hidden: boolean) => void;
  moveSidebarPinnedSection: (id: string, direction: "up" | "down") => void;
  markThreadVisited: (threadId: string, visitedAt: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  setDefaultAdvertisedEndpointKey: (key: string | null) => void;
  setSidebarProjectScopeKey: (projectKey: string | null) => void;
  setPullRequestMergeMethod: (method: PullRequestMergeMethod) => void;
  setProjectExpanded: (projectIds: string | readonly string[], expanded: boolean) => void;
  reorderProjects: (
    currentProjectOrder: readonly string[],
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
}

export const useUiStateStore = create<UiStateStore>((set, get) => ({
  ...readPersistedState(),
  createSidebarPinnedSection: (name) => {
    const state = get();
    if (
      state.sidebarPinnedSections.length >= MAX_SIDEBAR_PINNED_SECTIONS ||
      !validSidebarSectionName(state, name)
    ) {
      return null;
    }
    const id = randomUUID();
    set((state) => createSidebarPinnedSection(state, id, name));
    return id;
  },
  renameSidebarPinnedSection: (id, name) => {
    const state = get();
    if (
      !state.sidebarPinnedSections.some((section) => section.id === id) ||
      !validSidebarSectionName(state, name, id)
    ) {
      return false;
    }
    set((state) => renameSidebarPinnedSection(state, id, name));
    return true;
  },
  deleteSidebarPinnedSection: (id) => set((state) => deleteSidebarPinnedSection(state, id)),
  moveThreadsToPinnedSection: (threadKeys, sectionId) =>
    set((state) => moveThreadsToPinnedSection(state, threadKeys, sectionId)),
  toggleSidebarPinnedSection: (id) => set((state) => toggleSidebarPinnedSection(state, id)),
  setSidebarSectionCompact: (sectionKey, compact) =>
    set((state) => setSidebarSectionCompact(state, sectionKey, compact)),
  setThreadPrBadgeHidden: (threadKey, hidden) =>
    set((state) => setThreadPrBadgeHidden(state, threadKey, hidden)),
  moveSidebarPinnedSection: (id, direction) =>
    set((state) => moveSidebarPinnedSection(state, id, direction)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  setDefaultAdvertisedEndpointKey: (key) =>
    set((state) => setDefaultAdvertisedEndpointKey(state, key)),
  setSidebarProjectScopeKey: (projectKey) =>
    set((state) => setSidebarProjectScopeKey(state, projectKey)),
  setPullRequestMergeMethod: (method) => set((state) => setPullRequestMergeMethod(state, method)),
  setProjectExpanded: (projectIds, expanded) =>
    set((state) => setProjectExpanded(state, projectIds, expanded)),
  reorderProjects: (currentProjectOrder, draggedProjectIds, targetProjectIds) =>
    set((state) =>
      reorderProjects(state, currentProjectOrder, draggedProjectIds, targetProjectIds),
    ),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
