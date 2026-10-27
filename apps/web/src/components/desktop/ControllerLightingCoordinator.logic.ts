import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveSidebarThreadStatus, resolveSidebarV2TopStatus } from "../Sidebar.logic";

const CONTROLLER_LED_COUNT = 26;
export const CONTROLLER_PINNED_LED_INDICES = [0, 1, 2, 5, 6, 7] as const;
const CONTROLLER_AMBIENT_LED_INDICES = [3, 8, 4, 9, 14, 18, 22, 24, 13, 25] as const;
const WORKING_PULSE_PERIOD_MS = 2_000;
const UNSELECTED_PIN_INTENSITY = 0.18;

export const CONTROLLER_LIGHT = {
  dark: 0x000000,
  idle: 0xffffff,
  working: 0x0169cc,
  done: 0x00cc66,
  selected: 0x55aaff,
  pinned: 0x00152c,
  attention: 0xff6d00,
  disconnected: 0xffb000,
  error: 0xff0033,
  ambient: 0x102033,
  ambientSelected: 0x0169cc,
} as const;

export type ControllerThreadLightState =
  | "idle"
  | "working"
  | "done"
  | "attention"
  | "error"
  | "disconnected";

export function controllerSnoozeWakeDelay(
  threads: ReadonlyArray<{ readonly snoozedUntil?: string | null }>,
  now: number,
): number | null {
  const next = threads.reduce((earliest, thread) => {
    const wake = Date.parse(thread.snoozedUntil ?? "");
    return wake > now ? Math.min(earliest, wake) : earliest;
  }, Infinity);
  return Number.isFinite(next) ? Math.min(next - now + 50, 2_147_483_647) : null;
}

export function controllerWorkingPulseIntensity(now: number): number {
  const wave = (Math.sin((2 * Math.PI * now) / WORKING_PULSE_PERIOD_MS - Math.PI / 2) + 1) / 2;
  return 0.28 + wave * 0.72;
}

export function resolveControllerThreadLightState(
  thread: Pick<EnvironmentThreadShell, "runtime" | "latestRun"> & {
    readonly hasPendingApprovals?: boolean;
    readonly hasPendingUserInput?: boolean;
    readonly pendingSubagentRequest?: string | null;
    readonly blockedOnThreadWait?: boolean;
  },
  connected: boolean,
  presentation: { readonly isUnread?: boolean; readonly isWoke?: boolean } = {},
): ControllerThreadLightState {
  if (!connected) return "disconnected";
  const status = resolveSidebarThreadStatus({
    runtime: thread.runtime,
    hasPendingApprovals: thread.hasPendingApprovals === true,
    hasPendingUserInput: thread.hasPendingUserInput === true,
    pendingSubagentRequest:
      thread.pendingSubagentRequest === "approval" || thread.pendingSubagentRequest === "user_input"
        ? thread.pendingSubagentRequest
        : null,
    blockedOnThreadWait: thread.blockedOnThreadWait === true,
  });
  if (status === "approval" || status === "input") return "attention";
  if (status === "failed") return "error";
  if (status === "limited") return "attention";
  if (status === "working" || status === "waiting") return "working";
  const topStatus = resolveSidebarV2TopStatus({
    status,
    isUnread: presentation.isUnread === true,
    isWoke: presentation.isWoke === true,
  });
  if (topStatus === "woke") return "attention";
  return topStatus === "done" ? "done" : "idle";
}

const STATE_COLOR: Record<ControllerThreadLightState, number> = {
  idle: CONTROLLER_LIGHT.idle,
  done: CONTROLLER_LIGHT.done,
  working: CONTROLLER_LIGHT.working,
  attention: CONTROLLER_LIGHT.attention,
  disconnected: CONTROLLER_LIGHT.disconnected,
  error: CONTROLLER_LIGHT.error,
};

const SELECTED_STATE_COLOR: Record<ControllerThreadLightState, number> = {
  idle: 0xffffff,
  done: 0x55ffaa,
  working: 0x55aaff,
  attention: 0xffa040,
  disconnected: 0xffd060,
  error: 0xff5577,
};

export function createControllerLightingFrame(input: {
  readonly workingPulseIntensity?: number;
  readonly pins: ReadonlyArray<{
    readonly state: ControllerThreadLightState;
    readonly selected: boolean;
  } | null>;
  readonly secondary?: {
    readonly terminalOpen?: boolean;
    readonly browserOpen?: boolean;
    readonly pinOpen?: boolean;
    readonly infoOpen?: boolean;
    readonly diffOpen?: boolean;
    readonly effortIndex?: number | null;
    readonly effortCount?: number;
    readonly canLowerEffort?: boolean;
    readonly canRaiseEffort?: boolean;
  };
}): ReadonlyArray<number> {
  const colors = Array<number>(CONTROLLER_LED_COUNT).fill(CONTROLLER_LIGHT.dark);
  for (const index of CONTROLLER_AMBIENT_LED_INDICES) colors[index] = CONTROLLER_LIGHT.ambient;
  input.pins.slice(0, CONTROLLER_PINNED_LED_INDICES.length).forEach((pin, slot) => {
    if (!pin) return;
    const led = CONTROLLER_PINNED_LED_INDICES[slot];
    if (led !== undefined) {
      const color = pin.selected ? SELECTED_STATE_COLOR[pin.state] : STATE_COLOR[pin.state];
      const selectionIntensity = pin.selected ? 1 : UNSELECTED_PIN_INTENSITY;
      const pulseIntensity = pin.state === "working" ? (input.workingPulseIntensity ?? 1) : 1;
      colors[led] = scaleRgb(color, selectionIntensity * pulseIntensity);
    }
    if (pin.selected) {
      for (const index of CONTROLLER_AMBIENT_LED_INDICES)
        colors[index] = CONTROLLER_LIGHT.ambientSelected;
    }
  });
  const secondary = input.secondary;
  if (secondary) {
    colors[10] = secondary.terminalOpen ? CONTROLLER_LIGHT.idle : CONTROLLER_LIGHT.dark;
    colors[11] = secondary.browserOpen ? CONTROLLER_LIGHT.working : CONTROLLER_LIGHT.dark;
    colors[12] = secondary.pinOpen ? CONTROLLER_LIGHT.pinned : CONTROLLER_LIGHT.dark;
    colors[14] = secondary.infoOpen ? CONTROLLER_LIGHT.idle : CONTROLLER_LIGHT.dark;
    colors[22] = secondary.diffOpen ? CONTROLLER_LIGHT.working : CONTROLLER_LIGHT.dark;
    const count = secondary.effortCount ?? 0;
    const index = secondary.effortIndex;
    const intensity = count > 1 && index != null ? Math.max(0.2, (index + 1) / count) : 0;
    colors[15] =
      secondary.canLowerEffort && intensity > 0
        ? scaleRgb(CONTROLLER_LIGHT.working, intensity)
        : CONTROLLER_LIGHT.dark;
    colors[17] =
      secondary.canRaiseEffort && intensity > 0
        ? scaleRgb(CONTROLLER_LIGHT.working, intensity)
        : CONTROLLER_LIGHT.dark;
  }
  return colors;
}

function scaleRgb(color: number, intensity: number): number {
  const channel = (shift: number) => Math.round(((color >> shift) & 0xff) * intensity);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
