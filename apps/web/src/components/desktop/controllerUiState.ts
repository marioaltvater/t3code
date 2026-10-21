import { useSyncExternalStore } from "react";

export type ControllerThreadRef = { readonly environmentId: string; readonly threadId: string };
export type ControllerUiSnapshot = {
  readonly pinnedThreads: readonly ControllerThreadRef[] | null;
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
let snapshot: ControllerUiSnapshot = { pinnedThreads: null, secondary: EMPTY_SECONDARY };
const listeners = new Set<() => void>();

function update(next: ControllerUiSnapshot) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function publishControllerPins(pinnedThreads: readonly ControllerThreadRef[] | null) {
  if (samePins(snapshot.pinnedThreads, pinnedThreads)) return;
  update({ ...snapshot, pinnedThreads });
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

function samePins(
  left: ControllerUiSnapshot["pinnedThreads"],
  right: ControllerUiSnapshot["pinnedThreads"],
) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.length === right.length &&
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
