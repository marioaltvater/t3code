import {
  EnvironmentId,
  ThreadId,
  SidebarSectionError,
  type SidebarSectionEvent,
} from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { handleSidebarSectionRequest } from "./sidebarSectionClient";
import { parsePersistedState, PERSISTED_STATE_KEY, useUiStateStore } from "./uiStateStore";

function setup() {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    },
  });
  useUiStateStore.setState(
    parsePersistedState({
      sidebarPinnedSections: [
        {
          id: "chief",
          name: "Chief of Staff",
          collapsed: true,
          threadKeys: ["env:a", "other:research"],
        },
        { id: "talos", name: "Talos", collapsed: false, threadKeys: ["env:b", "env:c"] },
      ],
    }),
  );
  return storage;
}
const identity = {
  environmentId: EnvironmentId.make("env"),
  clientId: "desktop",
  connectionId: "connection",
  surface: "desktop" as const,
};
const event = (request: SidebarSectionEvent["request"]): SidebarSectionEvent => ({
  ...identity,
  request,
});
afterEach(() => vi.unstubAllGlobals());

it("lists only the target environment's members, retaining section and member order", () => {
  setup();
  expect(handleSidebarSectionRequest(event({ type: "list", requestId: "list" }))).toEqual({
    ...identity,
    sections: [
      { id: "chief", name: "Chief of Staff", collapsed: true, threadIds: ["a"] },
      { id: "talos", name: "Talos", collapsed: false, threadIds: ["b", "c"] },
    ],
  });
});
it("assigns one scoped thread, persists it, and is idempotent after reload", () => {
  const storage = setup();
  const request = event({
    type: "assign",
    requestId: "move",
    threadId: ThreadId.make("research"),
    sectionId: "talos",
    expectedSectionId: null,
  });
  const result = handleSidebarSectionRequest(request);
  expect(result.sections[1]?.threadIds).toEqual(["b", "c", "research"]);
  const saved = JSON.parse(storage.get(PERSISTED_STATE_KEY)!);
  expect(saved.sidebarPinnedSections[0].threadKeys).toEqual(["env:a", "other:research"]);
  useUiStateStore.setState(parsePersistedState(saved));
  expect(
    handleSidebarSectionRequest({
      ...request,
      request: {
        ...request.request,
        type: "assign",
        threadId: ThreadId.make("research"),
        sectionId: "talos",
        expectedSectionId: "talos",
      },
    }),
  ).toEqual(result);
});
it("rejects a stale placement and missing section before changing state", () => {
  setup();
  const before = useUiStateStore.getState();
  expect(() =>
    handleSidebarSectionRequest(
      event({
        type: "assign",
        requestId: "move",
        threadId: ThreadId.make("a"),
        sectionId: "talos",
        expectedSectionId: null,
      }),
    ),
  ).toThrow("membership_conflict");
  expect(() =>
    handleSidebarSectionRequest(
      event({
        type: "assign",
        requestId: "move",
        threadId: ThreadId.make("a"),
        sectionId: "gone",
        expectedSectionId: "chief",
      }),
    ),
  ).toThrow("section_not_found");
  expect(useUiStateStore.getState()).toBe(before);
});
it("never claims persistence when browser storage fails", () => {
  setup();
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() =>
    handleSidebarSectionRequest(
      event({
        type: "assign",
        requestId: "move",
        threadId: ThreadId.make("new"),
        sectionId: "talos",
        expectedSectionId: null,
      }),
    ),
  ).toThrow(new SidebarSectionError({ reason: "persistence_failed", outcomeUnknown: true }));
});
