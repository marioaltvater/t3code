import { ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSidebarPinnedSection,
  deleteSidebarPinnedSection,
  legacyProjectCwdPreferenceKey,
  MAX_SIDEBAR_PINNED_SECTIONS,
  MAX_SIDEBAR_SECTION_NAME_LENGTH,
  markThreadUnread,
  markThreadVisited,
  moveSidebarPinnedSection,
  moveThreadsToPinnedSection,
  parsePersistedState,
  PERSISTED_STATE_KEY,
  type PersistedUiState,
  persistState,
  renameSidebarPinnedSection,
  reorderProjects,
  resolveProjectExpanded,
  setProjectExpanded,
  setThreadPrBadgeHidden,
  toggleSidebarPinnedSection,
  setSidebarSectionCompact,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
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
    ...overrides,
  };
}

describe("uiStateStore pure functions", () => {
  it("hides and restores one thread without affecting the same ID in another environment", () => {
    const initial = makeUiState();
    const hidden = setThreadPrBadgeHidden(initial, "env-a:thread-1", true);
    expect(hidden.threadPrBadgeHiddenById["env-a:thread-1"]).toBe(true);
    expect(hidden.threadPrBadgeHiddenById["env-b:thread-1"]).toBeUndefined();
    const otherHidden = setThreadPrBadgeHidden(hidden, "env-b:thread-1", true);
    const restored = setThreadPrBadgeHidden(otherHidden, "env-a:thread-1", false);
    expect(restored.threadPrBadgeHiddenById).toEqual({
      "env-a:thread-1": false,
      "env-b:thread-1": true,
    });
  });

  it("defaults sidebar PR badges to visible and sanitizes saved choices", () => {
    expect(parsePersistedState({}).threadPrBadgeHiddenById).toEqual({});
    const saved = JSON.parse('{"env-a:thread-1":true,"env-b:thread-1":false,"bad":"true","":true}');
    expect(parsePersistedState({ threadPrBadgeHiddenById: saved }).threadPrBadgeHiddenById).toEqual(
      {
        "env-a:thread-1": true,
        "env-b:thread-1": false,
      },
    );
  });
  it("stores server timestamps without moving visit state backwards", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState();
    const visited = markThreadVisited(initialState, threadId, "2026-02-25T12:30:00.700Z");

    expect(visited.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:30:00.700Z");
    expect(markThreadVisited(visited, threadId, "2026-02-25T12:30:00.000Z")).toBe(visited);
    expect(markThreadVisited(visited, threadId, "not-a-date")).toBe(visited);
  });

  it("marks a completed thread unread using the server completion timestamp", () => {
    const threadId = ThreadId.make("thread-1");
    const initialState = makeUiState({
      threadLastVisitedAtById: {
        [threadId]: "2026-02-25T12:35:00.000Z",
      },
    });

    const next = markThreadUnread(initialState, threadId, "2026-02-25T12:30:00.000Z");

    expect(next.threadLastVisitedAtById[threadId]).toBe("2026-02-25T12:29:59.999Z");
    expect(markThreadUnread(next, threadId, null)).toBe(next);
  });

  it("resolves project expansion from logical, physical, and legacy preference keys", () => {
    const physicalKey = "environment:/repo/project";
    const legacyKey = legacyProjectCwdPreferenceKey("/repo/project");

    expect(resolveProjectExpanded({ logical: false, [physicalKey]: true }, ["logical"])).toBe(
      false,
    );
    expect(resolveProjectExpanded({ [physicalKey]: false }, ["new-logical", physicalKey])).toBe(
      false,
    );
    expect(resolveProjectExpanded({ [legacyKey]: false }, ["new-logical", legacyKey])).toBe(false);
    expect(resolveProjectExpanded({}, ["new-logical"])).toBe(true);
  });

  it("sets expansion for every stable key belonging to a logical project", () => {
    const initialState = makeUiState();
    const keys = ["logical", "environment-a:/repo", "environment-b:/repo"];

    const next = setProjectExpanded(initialState, keys, false);

    expect(next.projectExpandedById).toEqual({
      logical: false,
      "environment-a:/repo": false,
      "environment-b:/repo": false,
    });
    expect(setProjectExpanded(next, keys, false)).toBe(next);
  });

  it("moves grouped project members together", () => {
    const keyALocal = "env-local:proj-a";
    const keyARemote = "env-remote:proj-a";
    const keyB = "env-local:proj-b";
    const keyC = "env-local:proj-c";
    const currentOrder = [keyALocal, keyARemote, keyB, keyC];

    const next = reorderProjects(makeUiState(), currentOrder, [keyALocal, keyARemote], [keyC]);

    expect(next.projectOrder).toEqual([keyB, keyC, keyALocal, keyARemote]);
  });
});

describe("parsePersistedState", () => {
  it("keeps compact defaults and ignores malformed or deleted section preferences", () => {
    expect(parsePersistedState({}).sidebarCompactSections).toEqual({
      snoozed: true,
      settled: true,
    });
    const parsed = parsePersistedState({
      sidebarPinnedSections: [
        { id: "research", name: "Research", threadKeys: [], collapsed: false },
      ],
      sidebarCompactSections: {
        pinned: true,
        active: true,
        settled: false,
        "pinned-section:research": true,
        "pinned-section:deleted": true,
        working: "yes",
      },
    } as unknown as PersistedUiState);
    expect(parsed.sidebarCompactSections).toEqual({
      pinned: true,
      active: true,
      snoozed: true,
      settled: false,
      "pinned-section:research": true,
    });
  });

  it("defaults missing and malformed pinned sections to empty", () => {
    expect(parsePersistedState({}).sidebarPinnedSections).toEqual([]);
    expect(
      parsePersistedState({ sidebarPinnedSections: {} } as unknown as PersistedUiState)
        .sidebarPinnedSections,
    ).toEqual([]);
  });

  it("sanitizes sections with first-wins identity, names, and thread membership", () => {
    const parsed = parsePersistedState({
      sidebarPinnedSections: [
        null,
        7,
        { id: " ", name: "Invalid", threadKeys: ["ignored"] },
        { id: "blank-name", name: "  " },
        {
          id: "first",
          name: " Work ",
          threadKeys: ["env-a:t1", "env-a:t1", "", 7],
          collapsed: true,
        },
        { id: "first", name: "Duplicate ID", threadKeys: ["env-a:t2"] },
        { id: "duplicate-name", name: "work", threadKeys: ["env-a:t2"] },
        {
          id: "second",
          name: "Other",
          threadKeys: ["env-a:t1", "env-a:t2", "offline:t3"],
          collapsed: "yes",
        },
        { id: "third", name: "Empty", threadKeys: null },
      ],
    } as unknown as PersistedUiState);

    expect(parsed.sidebarPinnedSections).toEqual([
      { id: "first", name: "Work", threadKeys: ["env-a:t1"], collapsed: true },
      { id: "second", name: "Other", threadKeys: ["env-a:t2", "offline:t3"], collapsed: false },
      { id: "third", name: "Empty", threadKeys: [], collapsed: false },
    ]);
  });

  it("bounds loaded section names and the number of accepted sections", () => {
    const parsed = parsePersistedState({
      sidebarPinnedSections: [
        { id: "invalid", name: "", threadKeys: [], collapsed: false },
        ...Array.from({ length: MAX_SIDEBAR_PINNED_SECTIONS + 2 }, (_, index) => ({
          id: `${index}`,
          name: `${index}-` + "x".repeat(MAX_SIDEBAR_SECTION_NAME_LENGTH),
          threadKeys: [],
          collapsed: false,
        })),
      ],
    });

    expect(parsed.sidebarPinnedSections).toHaveLength(MAX_SIDEBAR_PINNED_SECTIONS);
    expect(parsed.sidebarPinnedSections[0]?.id).toBe("0");
    expect(
      parsed.sidebarPinnedSections.every(
        (section) => section.name.length === MAX_SIDEBAR_SECTION_NAME_LENGTH,
      ),
    ).toBe(true);
  });

  it("hydrates the last selected pull request merge method", () => {
    const parsed = parsePersistedState({
      pullRequestMergeMethod: "squash",
    });
    const invalid = parsePersistedState({
      pullRequestMergeMethod: "fast-forward",
    });

    expect(parsed.pullRequestMergeMethod).toBe("squash");
    expect(invalid.pullRequestMergeMethod).toBe("merge");
  });

  it("hydrates raw UI-owned state without server entities", () => {
    const parsed = parsePersistedState({
      projectExpandedById: {
        logical: false,
        invalid: "no" as unknown as boolean,
      },
      projectOrder: ["physical-b", "", "physical-a", "physical-b"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
        invalid: "not-a-date",
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      threadChangedFilesExpansionVersion: 2,
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
    });

    expect(parsed).toEqual({
      projectExpandedById: {
        logical: false,
      },
      projectOrder: ["physical-b", "physical-a"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectScopeKey: null,
      sidebarPinnedSections: [],
      sidebarCompactSections: { snoozed: true, settled: true },
      pullRequestMergeMethod: "merge",
      threadPrBadgeHiddenById: {},
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
    });
  });

  it.each([undefined, 1])("ignores changed-file expansion version %s", (version) => {
    const parsed = parsePersistedState({
      ...(version === undefined ? {} : { threadChangedFilesExpansionVersion: version }),
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
        },
      },
    });

    expect(parsed.threadChangedFilesExpandedById).toEqual({});
  });

  it("migrates legacy CWD project preferences into local alias keys", () => {
    const parsed = parsePersistedState({
      collapsedProjectCwds: ["/repo/b"],
      expandedProjectCwds: ["/repo/a"],
      projectOrderCwds: ["/repo/b", "/repo/a"],
    });
    const projectAKey = legacyProjectCwdPreferenceKey("/repo/a");
    const projectBKey = legacyProjectCwdPreferenceKey("/repo/b");

    expect(parsed.projectOrder).toEqual([projectBKey, projectAKey]);
    expect(resolveProjectExpanded(parsed.projectExpandedById, [projectAKey])).toBe(true);
    expect(resolveProjectExpanded(parsed.projectExpandedById, [projectBKey])).toBe(false);
    expect(resolveProjectExpanded(parsed.projectExpandedById, ["unknown"])).toBe(true);
  });
});

describe("named pinned sections", () => {
  function sectionsState(): UiState {
    return makeUiState({
      sidebarPinnedSections: [
        { id: "work", name: "Work", threadKeys: ["env-a:t1", "offline:t2"], collapsed: false },
        { id: "personal", name: "Personal", threadKeys: ["env-b:t1"], collapsed: true },
      ],
    });
  }

  it("creates trimmed, expanded, empty sections and enforces IDs, names, and limits", () => {
    const state = sectionsState();
    const next = createSidebarPinnedSection(state, "new", " New ");
    expect(next.sidebarPinnedSections.at(-1)).toEqual({
      id: "new",
      name: "New",
      threadKeys: [],
      collapsed: false,
    });
    expect(state.sidebarPinnedSections).toHaveLength(2);
    expect(createSidebarPinnedSection(state, "new", " work ")).toBe(state);
    expect(createSidebarPinnedSection(state, "work", "New")).toBe(state);
    expect(createSidebarPinnedSection(state, " ", "New")).toBe(state);
    expect(createSidebarPinnedSection(state, "new", " ")).toBe(state);
    expect(
      createSidebarPinnedSection(state, "new", "x".repeat(MAX_SIDEBAR_SECTION_NAME_LENGTH + 1)),
    ).toBe(state);
    expect(
      createSidebarPinnedSection(state, "new", "x".repeat(MAX_SIDEBAR_SECTION_NAME_LENGTH))
        .sidebarPinnedSections,
    ).toHaveLength(3);
    let full = makeUiState();
    for (let index = 0; index < MAX_SIDEBAR_PINNED_SECTIONS; index++) {
      full = createSidebarPinnedSection(full, `${index}`, `Section ${index}`);
    }
    expect(full.sidebarPinnedSections).toHaveLength(MAX_SIDEBAR_PINNED_SECTIONS);
    expect(createSidebarPinnedSection(full, "overflow", "Overflow")).toBe(full);
  });

  it("renames without losing membership, order, or collapse state", () => {
    const state = sectionsState();
    const next = renameSidebarPinnedSection(state, "personal", " Family ");
    expect(next.sidebarPinnedSections).toEqual([
      state.sidebarPinnedSections[0],
      { ...state.sidebarPinnedSections[1], name: "Family" },
    ]);
    expect(renameSidebarPinnedSection(state, "personal", "WORK")).toBe(state);
    expect(renameSidebarPinnedSection(state, "personal", " ")).toBe(state);
    expect(
      renameSidebarPinnedSection(
        state,
        "personal",
        "x".repeat(MAX_SIDEBAR_SECTION_NAME_LENGTH + 1),
      ),
    ).toBe(state);
    expect(renameSidebarPinnedSection(state, "personal", "Personal")).toBe(state);
    expect(renameSidebarPinnedSection(state, "missing", "New")).toBe(state);
  });

  it("moves scoped threads between buckets with unique membership and stable ordering", () => {
    const state = sectionsState();
    const next = moveThreadsToPinnedSection(
      state,
      ["env-a:t1", "env-a:t1", "offline:new", ""],
      "personal",
    );
    expect(next.sidebarPinnedSections).toEqual([
      { ...state.sidebarPinnedSections[0], threadKeys: ["offline:t2"] },
      { ...state.sidebarPinnedSections[1], threadKeys: ["env-b:t1", "env-a:t1", "offline:new"] },
    ]);
    expect(state.sidebarPinnedSections[0]?.threadKeys).toEqual(["env-a:t1", "offline:t2"]);
    expect(moveThreadsToPinnedSection(next, ["env-a:t1"], "personal")).toBe(next);
    expect(moveThreadsToPinnedSection(state, ["env-a:t1"], "missing")).toBe(state);
    expect(moveThreadsToPinnedSection(state, [], "personal")).toBe(state);
  });

  it("returns threads to default Pinned and deletes only section organization", () => {
    const state = sectionsState();
    const next = moveThreadsToPinnedSection(state, ["env-a:t1", "env-b:t1"], null);
    expect(next.sidebarPinnedSections.map((section) => section.threadKeys)).toEqual([
      ["offline:t2"],
      [],
    ]);
    expect(moveThreadsToPinnedSection(next, ["env-a:t1"], null)).toBe(next);
    expect(deleteSidebarPinnedSection(state, "work")).toEqual({
      ...state,
      sidebarPinnedSections: [state.sidebarPinnedSections[1]],
    });
    expect(deleteSidebarPinnedSection(state, "missing")).toBe(state);
  });

  it("toggles density independently and discards only a deleted section's preference", () => {
    const state = sectionsState();
    const compact = setSidebarSectionCompact(state, "pinned-section:work", true);
    const active = setSidebarSectionCompact(compact, "active", true);
    const expandedSettled = setSidebarSectionCompact(active, "settled", false);
    expect(expandedSettled.sidebarCompactSections).toEqual({
      snoozed: true,
      settled: false,
      active: true,
      "pinned-section:work": true,
    });
    expect(
      setSidebarSectionCompact(compact, "pinned-section:work", false).sidebarCompactSections[
        "pinned-section:work"
      ],
    ).toBe(false);
    expect(expandedSettled.sidebarPinnedSections).toBe(state.sidebarPinnedSections);
    expect(deleteSidebarPinnedSection(expandedSettled, "work").sidebarCompactSections).toEqual({
      snoozed: true,
      settled: false,
      active: true,
    });
  });

  it("toggles collapse and moves sections in both directions without changing membership", () => {
    const state = sectionsState();
    const toggled = toggleSidebarPinnedSection(state, "work");
    expect(toggled.sidebarPinnedSections[0]?.collapsed).toBe(true);
    expect(toggleSidebarPinnedSection(toggled, "work")).toEqual(state);
    expect(toggleSidebarPinnedSection(state, "missing")).toBe(state);
    const moved = moveSidebarPinnedSection(state, "work", "down");
    expect(moved.sidebarPinnedSections).toEqual(state.sidebarPinnedSections.toReversed());
    expect(moveSidebarPinnedSection(moved, "work", "up")).toEqual(state);
    expect(moveSidebarPinnedSection(state, "work", "up")).toBe(state);
    expect(moveSidebarPinnedSection(state, "personal", "down")).toBe(state);
    expect(moveSidebarPinnedSection(state, "missing", "down")).toBe(state);
  });
});

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("uiStateStore persistence", () => {
  let localStorageStub: Storage;

  beforeEach(() => {
    localStorageStub = createLocalStorageStub();
    vi.stubGlobal("window", { localStorage: localStorageStub });
    vi.stubGlobal("localStorage", localStorageStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists raw UI preferences including thread visit markers", () => {
    const state = makeUiState({
      projectExpandedById: {
        logical: false,
      },
      projectOrder: ["physical-b", "physical-a"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
      },
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
    });

    persistState(state);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(persisted).toEqual({
      projectExpandedById: {
        logical: false,
      },
      projectOrder: ["physical-b", "physical-a"],
      threadLastVisitedAtById: {
        "environment:thread-1": "2026-02-25T12:35:00.000Z",
      },
      defaultAdvertisedEndpointKey: "desktop-core:lan:http",
      sidebarProjectScopeKey: null,
      sidebarPinnedSections: [],
      sidebarCompactSections: { snoozed: true, settled: true },
      threadChangedFilesExpansionVersion: 2,
      threadPrBadgeHiddenById: {},
      threadChangedFilesExpandedById: {
        "environment:thread-1": {
          "turn-1": false,
          "turn-2": true,
        },
      },
      pullRequestMergeMethod: "merge",
    });
    expect(parsePersistedState(persisted)).toEqual({
      ...state,
    });
  });

  it("restores the sidebar project scope across reloads", () => {
    persistState(makeUiState({ sidebarProjectScopeKey: "github.com/pingdotgg/t3code" }));

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;

    expect(parsePersistedState(persisted).sidebarProjectScopeKey).toBe(
      "github.com/pingdotgg/t3code",
    );
  });

  it("restores per-environment sidebar PR choices across reloads", () => {
    const hidden = setThreadPrBadgeHidden(makeUiState(), "env-a:thread-1", true);
    const state = setThreadPrBadgeHidden(hidden, "env-b:thread-1", false);
    persistState(state);
    const persisted = JSON.parse(localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}");
    expect(parsePersistedState(persisted).threadPrBadgeHiddenById).toEqual({
      "env-a:thread-1": true,
      "env-b:thread-1": false,
    });
  });

  it("round-trips section order, names, disconnected membership, collapse, and compact choices", () => {
    const state = makeUiState({
      sidebarPinnedSections: [
        { id: "b", name: "Later", threadKeys: ["offline:thread"], collapsed: true },
        { id: "a", name: "Today", threadKeys: ["env-a:thread", "env-b:thread"], collapsed: false },
      ],
      sidebarCompactSections: {
        pinned: true,
        active: false,
        snoozed: true,
        settled: false,
        "pinned-section:a": true,
      },
    });
    persistState(state);
    const persisted = JSON.parse(localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}");
    expect(persisted.sidebarPinnedSections).toEqual(state.sidebarPinnedSections);
    expect(parsePersistedState(persisted)).toEqual(state);
  });

  it("drops the temporary expanded-only migration fallback when rewriting state", () => {
    const migrated = parsePersistedState({
      expandedProjectCwds: ["/repo/a"],
    });

    persistState(migrated);

    const persisted = JSON.parse(
      localStorageStub.getItem(PERSISTED_STATE_KEY) ?? "{}",
    ) as PersistedUiState;
    expect(resolveProjectExpanded(persisted.projectExpandedById ?? {}, ["unknown"])).toBe(true);
    expect(persisted).not.toHaveProperty("threadPanelOpen");
  });
});
