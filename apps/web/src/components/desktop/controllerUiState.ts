import { useSyncExternalStore } from "react";
import type { ControllerThreadTargets } from "./controllerThreadTargets";

export type ControllerThreadRef = { readonly environmentId: string; readonly threadId: string };
export type ControllerUiSnapshot = {
  readonly threadTargets: ControllerThreadTargets | null;
  readonly secondary: {
    readonly terminalOpen: boolean;
    readonly browserOpen: boolean;
    readonly pinOpen: boolean;
    readonly infoOpen: boolean;
    readonly diffOpen: boolean;
    readonly effortIndex: number | null;
    readonly effortCount: number;
    readonly canLowerEffort: boolean;
    readonly canRaiseEffort: boolean;
  };
};

const EMPTY_SECONDARY: ControllerUiSnapshot["secondary"] = {
  terminalOpen: false,
  browserOpen: false,
  pinOpen: false,
  infoOpen: false,
  diffOpen: false,
  effortIndex: null,
  effortCount: 0,
  canLowerEffort: false,
  canRaiseEffort: false,
};
let snapshot: ControllerUiSnapshot = { threadTargets: null, secondary: EMPTY_SECONDARY };
const listeners = new Set<() => void>();

function update(next: ControllerUiSnapshot) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function publishControllerThreadTargets(threadTargets: ControllerThreadTargets | null) {
  const previous = snapshot.threadTargets;
  if (
    previous === threadTargets ||
    (previous !== null &&
      threadTargets !== null &&
      sameThreads(previous.activeThreads, threadTargets.activeThreads) &&
      sameThreads(previous.chiefOfStaffThreads, threadTargets.chiefOfStaffThreads))
  )
    return;
  update({ ...snapshot, threadTargets });
}

export function publishControllerSecondary(secondary: Partial<ControllerUiSnapshot["secondary"]>) {
  const next = { ...snapshot.secondary, ...secondary };
  if (sameSecondary(snapshot.secondary, next)) return;
  update({ ...snapshot, secondary: next });
}

export function publishControllerEffort(
  effort: Pick<
    ControllerUiSnapshot["secondary"],
    "effortIndex" | "effortCount" | "canLowerEffort" | "canRaiseEffort"
  >,
) {
  publishControllerSecondary(effort);
}

function sameThreads(left: readonly ControllerThreadRef[], right: readonly ControllerThreadRef[]) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every(
        (pin, index) =>
          pin.environmentId === right[index]?.environmentId &&
          pin.threadId === right[index]?.threadId,
      ))
  );
}

function sameSecondary(
  left: ControllerUiSnapshot["secondary"],
  right: ControllerUiSnapshot["secondary"],
) {
  return (Object.keys(left) as Array<keyof ControllerUiSnapshot["secondary"]>).every(
    (key) => left[key] === right[key],
  );
}

export function useControllerUiSnapshot() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}
