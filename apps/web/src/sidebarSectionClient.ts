import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  SidebarSectionError,
  type SidebarSectionEvent,
  type SidebarSectionsSnapshot,
} from "@t3tools/contracts";
import {
  PERSISTED_STATE_KEY,
  parsePersistedState,
  flushUiStatePersistence,
  useUiStateStore,
} from "./uiStateStore";

export function handleSidebarSectionRequest(event: SidebarSectionEvent): SidebarSectionsSnapshot {
  const { request, ...identity } = event;
  const state = useUiStateStore.getState();
  if (request.type === "assign") {
    // Another tab can persist changes without updating this connection's cached store.
    // Reject before mutating: even the normal debounced writer would otherwise erase them.
    let persisted;
    try {
      persisted = parsePersistedState(
        JSON.parse(window.localStorage.getItem(PERSISTED_STATE_KEY) ?? "{}"),
      );
    } catch {
      throw new SidebarSectionError({ reason: "persistence_failed", outcomeUnknown: false });
    }
    if (
      Object.entries(persisted).some(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(state[key as keyof typeof persisted]),
      )
    )
      throw new SidebarSectionError({ reason: "stale_client_state", outcomeUnknown: false });
    if (
      request.sectionId !== null &&
      !state.sidebarPinnedSections.some((section) => section.id === request.sectionId)
    )
      throw new SidebarSectionError({ reason: "section_not_found", outcomeUnknown: false });
    const key = scopedThreadKey(scopeThreadRef(event.environmentId, request.threadId));
    const memberships = state.sidebarPinnedSections.filter((section) =>
      section.threadKeys.includes(key),
    );
    if (memberships.length > 1 || (memberships[0]?.id ?? null) !== request.expectedSectionId)
      throw new SidebarSectionError({ reason: "membership_conflict", outcomeUnknown: false });
    state.moveThreadsToPinnedSection([key], request.sectionId);
    const updated = useUiStateStore.getState();
    flushUiStatePersistence();
    // The normal writer tolerates storage errors for UI use. An agent receipt must prove durability.
    try {
      const persisted: unknown = JSON.parse(
        window.localStorage.getItem(PERSISTED_STATE_KEY) ?? "null",
      );
      if (
        persisted === null ||
        typeof persisted !== "object" ||
        !("sidebarPinnedSections" in persisted) ||
        JSON.stringify(persisted.sidebarPinnedSections) !==
          JSON.stringify(updated.sidebarPinnedSections)
      )
        throw new Error("Sections were not persisted");
    } catch {
      throw new SidebarSectionError({ reason: "persistence_failed", outcomeUnknown: true });
    }
  }
  return {
    ...identity,
    sections: useUiStateStore.getState().sidebarPinnedSections.map((section) => ({
      id: section.id,
      name: section.name,
      collapsed: section.collapsed,
      threadIds: section.threadKeys.flatMap((key) => {
        const ref = parseScopedThreadKey(key);
        return ref?.environmentId === event.environmentId ? [ref.threadId] : [];
      }),
    })),
  };
}
