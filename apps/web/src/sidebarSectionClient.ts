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
import { PERSISTED_STATE_KEY, persistState, useUiStateStore } from "./uiStateStore";

export function handleSidebarSectionRequest(event: SidebarSectionEvent): SidebarSectionsSnapshot {
  const { request, ...identity } = event;
  const state = useUiStateStore.getState();
  if (request.type === "assign") {
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
    persistState(updated);
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
