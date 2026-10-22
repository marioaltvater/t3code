import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { SidebarPinnedSection } from "../../uiStateStore";
import type { ControllerThreadRef } from "./controllerUiState";

export type ControllerThreadTargets = {
  readonly activeThreads: readonly ControllerThreadRef[];
  readonly chiefOfStaffThreads: readonly ControllerThreadRef[];
};

type Thread = Pick<EnvironmentThreadShell, "environmentId" | "id">;

export function resolveControllerThreadTargets(input: {
  readonly activeThreads: readonly Thread[];
  readonly pinnedThreads: readonly Thread[];
  readonly pinnedSections: readonly SidebarPinnedSection[];
}): ControllerThreadTargets {
  const section = input.pinnedSections[0];
  const sectionKeys = new Set(section?.threadKeys);
  const toRef = (thread: Thread): ControllerThreadRef => ({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  return {
    activeThreads: input.activeThreads.slice(0, 6).map(toRef),
    chiefOfStaffThreads: input.pinnedThreads
      .filter((thread) =>
        sectionKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      )
      .slice(0, 4)
      .map(toRef),
  };
}

export function controllerThreadSlotFromCommand(command: string) {
  const match = /^thread\.(active|chiefOfStaff)\.([1-6])$/.exec(command);
  if (!match || (match[1] === "chiefOfStaff" && Number(match[2]) > 4)) return null;
  return {
    shelf: match[1] === "active" ? ("activeThreads" as const) : ("chiefOfStaffThreads" as const),
    index: Number(match[2]) - 1,
  };
}

export function controllerThreadTargetFromCommand(
  command: string,
  targets: ControllerThreadTargets,
): ControllerThreadRef | null {
  const slot = controllerThreadSlotFromCommand(command);
  return slot ? (targets[slot.shelf][slot.index] ?? null) : null;
}
