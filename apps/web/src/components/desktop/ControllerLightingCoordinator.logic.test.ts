import { describe, expect, it } from "vite-plus/test";
import {
  CONTROLLER_LIGHT,
  CONTROLLER_PINNED_LED_INDICES,
  createControllerLightingFrame,
  controllerWorkingPulseIntensity,
  controllerSnoozeWakeDelay,
  resolveControllerThreadLightState,
} from "./ControllerLightingCoordinator.logic";

describe("controller lighting projection", () => {
  it("uses the Codex pin states and physical six-slot layout", () => {
    const frame = createControllerLightingFrame({
      pins: [
        { state: "working", selected: false },
        { state: "idle", selected: false },
        { state: "attention", selected: false },
        { state: "error", selected: false },
      ],
    });
    expect(frame).toHaveLength(26);
    expect(CONTROLLER_PINNED_LED_INDICES.map((index) => frame[index])).toEqual([
      CONTROLLER_LIGHT.working,
      CONTROLLER_LIGHT.idle,
      CONTROLLER_LIGHT.attention,
      CONTROLLER_LIGHT.error,
      CONTROLLER_LIGHT.dark,
      CONTROLLER_LIGHT.dark,
    ]);
  });

  it("shows selected pins steadily with a blue ambient border", () => {
    const frame = createControllerLightingFrame({ pins: [{ state: "error", selected: true }] });
    expect(frame[0]).toBe(0xff5577);
    expect(frame[3]).toBe(CONTROLLER_LIGHT.ambientSelected);
  });

  it("fades only working pin lights through a blue pulse", () => {
    const dim = controllerWorkingPulseIntensity(0);
    const bright = controllerWorkingPulseIntensity(1_000);
    const dimFrame = createControllerLightingFrame({
      pins: [
        { state: "working", selected: false },
        { state: "idle", selected: false },
      ],
      workingPulseIntensity: dim,
    });
    const brightFrame = createControllerLightingFrame({
      pins: [
        { state: "working", selected: false },
        { state: "idle", selected: false },
      ],
      workingPulseIntensity: bright,
    });

    expect(dim).toBe(0.28);
    expect(bright).toBe(1);
    expect(dimFrame[0]).toBeLessThan(brightFrame[0]!);
    expect(dimFrame[1]).toBe(CONTROLLER_LIGHT.idle);
    expect(brightFrame[0]).toBe(CONTROLLER_LIGHT.working);
  });

  it("distinguishes disconnected, approval, failure, and active threads", () => {
    expect(
      resolveControllerThreadLightState({ runtime: { status: "running" } } as never, false),
    ).toBe("disconnected");
    expect(
      resolveControllerThreadLightState(
        { runtime: { status: "running" }, hasPendingApprovals: true } as never,
        true,
      ),
    ).toBe("attention");
    expect(
      resolveControllerThreadLightState({ runtime: { status: "failed" } } as never, true),
    ).toBe("error");
    expect(
      resolveControllerThreadLightState({ runtime: { status: "running" } } as never, true),
    ).toBe("working");
    expect(
      resolveControllerThreadLightState(
        { runtime: { status: "running" }, latestRun: { status: "failed" } } as never,
        true,
      ),
    ).toBe("working");
    expect(
      resolveControllerThreadLightState(
        { runtime: { status: "failed", lastErrorClass: "usage_limit" } } as never,
        true,
      ),
    ).toBe("attention");
  });

  it("lights visible controls and scales effort LEDs from the selected descriptor index", () => {
    const frame = createControllerLightingFrame({
      pins: [],
      secondary: {
        terminalOpen: true,
        browserOpen: true,
        pinOpen: true,
        infoOpen: true,
        diffOpen: true,
        effortIndex: 1,
        effortCount: 3,
        canLowerEffort: true,
        canRaiseEffort: true,
      },
    });
    expect(frame.slice(10, 13)).toEqual([
      CONTROLLER_LIGHT.idle,
      CONTROLLER_LIGHT.working,
      CONTROLLER_LIGHT.idle,
    ]);
    expect(frame[13]).toBe(CONTROLLER_LIGHT.ambient);
    expect(frame[14]).toBe(CONTROLLER_LIGHT.idle);
    expect(frame[22]).toBe(CONTROLLER_LIGHT.working);
    expect(frame[15]).toBeGreaterThan(0);
    expect(frame[17]).toBe(frame[15]);
    expect(
      createControllerLightingFrame({
        pins: [],
        secondary: { effortIndex: null, effortCount: 0 },
      })[15],
    ).toBe(CONTROLLER_LIGHT.dark);
  });
});

it("wakes Settings lighting at the next snooze expiry and caps long timers", () => {
  const now = Date.parse("2026-10-21T08:00:00Z");
  expect(
    controllerSnoozeWakeDelay(
      [
        { snoozedUntil: new Date(now - 1).toISOString() },
        { snoozedUntil: new Date(now + 5_000).toISOString() },
        { snoozedUntil: new Date(now + 1_000).toISOString() },
      ],
      now,
    ),
  ).toBe(1_050);
  expect(controllerSnoozeWakeDelay([{ snoozedUntil: "invalid" }], now)).toBeNull();
  expect(controllerSnoozeWakeDelay([{ snoozedUntil: "2099-01-01T00:00:00Z" }], now)).toBe(
    2_147_483_647,
  );
});
