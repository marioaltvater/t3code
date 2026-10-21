import { ProjectId, ThreadId } from "@t3tools/contracts";
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
  setDefaultAdvertisedEndpointKey,
  setProjectExpanded,
  setSidebarProjectScopeKey,
  setThreadChangedFilesExpanded,
  toggleSidebarPinnedSection,
  type UiState,
} from "./uiStateStore";

function makeUiState(overrides: Partial<UiState> = {}): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    sidebarProjectScopeKey: null,
    sidebarPinnedSections: [],
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    defaultAdvertisedEndpointKey: null,
    pullRequestMergeMethod: "merge",
    ...overrides,
  };
}

describe("uiStateStore pure functions", () => {
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

  it("reorders from the current atom-derived project order", () => {
    const project1 = ProjectId.make("project-1");
    const project2 = ProjectId.make("project-2");
    const project3 = ProjectId.make("project-3");
    const currentOrder = [project1, project2, project3];

    const next = reorderProjects(makeUiState(), currentOrder, [project1], [project3]);

    expect(next.projectOrder).toEqual([project2, project3, project1]);
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

  it("does not reorder missing or identical groups", () => {
    const currentOrder = ["env-local:proj-a", "env-local:proj-b"];
    const state = makeUiState();

    expect(reorderProjects(state, currentOrder, ["env-local:missing"], ["env-local:proj-b"])).toBe(
      state,
    );
    expect(reorderProjects(state, currentOrder, ["env-local:proj-a"], ["env-local:proj-a"])).toBe(
      state,
    );
  });

  it("stores explicit changed-file expansion choices", () => {
    const threadId = ThreadId.make("thread-1");
    const collapsed = setThreadChangedFilesExpanded(makeUiState(), threadId, "turn-1", false);

    expect(collapsed.threadChangedFilesExpandedById).toEqual({
      [threadId]: {
        "turn-1": false,
      },
    });
    expect(
      setThreadChangedFilesExpanded(collapsed, threadId, "turn-1", true)
        .threadChangedFilesExpandedById,
    ).toEqual({
      [threadId]: {
        "turn-1": true,
      },
    });
  });

  it("stores the endpoint preference by stable key", () => {
    const next = setDefaultAdvertisedEndpointKey(makeUiState(), "desktop-core:lan:http");

    expect(next.defaultAdvertisedEndpointKey).toBe("desktop-core:lan:http");
    expect(setDefaultAdvertisedEndpointKey(next, "desktop-core:lan:http")).toBe(next);
    expect(setDefaultAdvertisedEndpointKey(next, "")).toMatchObject({
      defaultAdvertisedEndpointKey: null,
    });
  });

  it("stores the sidebar project scope and resets it to all projects", () => {
    const scoped = setSidebarProjectScopeKey(makeUiState(), "github.com/pingdotgg/t3code");

    expect(scoped.sidebarProjectScopeKey).toBe("github.com/pingdotgg/t3code");
    expect(setSidebarProjectScopeKey(scoped, "github.com/pingdotgg/t3code")).toBe(scoped);
    expect(setSidebarProjectScopeKey(scoped, null).sidebarProjectScopeKey).toBeNull();
    expect(setSidebarProjectScopeKey(scoped, "").sidebarProjectScopeKey).toBeNull();
  });
});

describe("parsePersistedState", () => {
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
      pullRequestMergeMethod: "merge",
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

  it("preserves legacy expanded-only semantics for one-way migration", () => {
    const parsed = parsePersistedState({
      expandedProjectCwds: ["/repo/a"],
    });

    expect(
      resolveProjectExpanded(parsed.projectExpandedById, [
        legacyProjectCwdPreferenceKey("/repo/a"),
      ]),
    ).toBe(true);
    expect(
      resolveProjectExpanded(parsed.projectExpandedById, [
        legacyProjectCwdPreferenceKey("/repo/b"),
      ]),
    ).toBe(false);
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
      threadChangedFilesExpansionVersion: 2,
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

  it("round-trips section order, names, disconnected membership, and collapse choices", () => {
    const state = makeUiState({
      sidebarPinnedSections: [
        { id: "b", name: "Later", threadKeys: ["offline:thread"], collapsed: true },
        { id: "a", name: "Today", threadKeys: ["env-a:thread", "env-b:thread"], collapsed: false },
      ],
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
