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
      0x001325,
      0x2e2e2e,
      0x2e1400,
      0x2e0009,
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
    expect(dimFrame[1]).toBe(0x2e2e2e);
    expect(brightFrame[0]).toBe(0x001325);
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
      CONTROLLER_LIGHT.pinned,
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

it("keeps Done green steady and gives active and wake states priority", () => {
  const unread = { isUnread: true };
  const completed = { runtime: null, latestRun: null } as never;
  expect(resolveControllerThreadLightState(completed, true, unread)).toBe("done");
  expect(resolveControllerThreadLightState(completed, true, { isUnread: false })).toBe("idle");
  expect(resolveControllerThreadLightState(completed, false, unread)).toBe("disconnected");
  expect(resolveControllerThreadLightState(completed, true, { ...unread, isWoke: true })).toBe(
    "attention",
  );
  for (const [status, expected] of [
    ["running", "working"],
    ["failed", "error"],
  ] as const) {
    expect(resolveControllerThreadLightState({ runtime: { status } } as never, true, unread)).toBe(
      expected,
    );
  }
  expect(
    resolveControllerThreadLightState(
      { runtime: null, hasPendingApprovals: true } as never,
      true,
      unread,
    ),
  ).toBe("attention");
  const pins = [
    { state: "done" as const, selected: false },
    { state: "done" as const, selected: true },
  ];
  const dim = createControllerLightingFrame({ pins, workingPulseIntensity: 0.28 });
  expect(dim).toEqual(createControllerLightingFrame({ pins, workingPulseIntensity: 1 }));
  expect(dim[0]).toBe(0x002512);
  expect(dim[1]).toBe(0x55ffaa);
});

it("makes the selected idle slot brighter and moves the highlight with selection", () => {
  const before = createControllerLightingFrame({
    pins: [
      { state: "idle", selected: true },
      { state: "idle", selected: false },
    ],
  });
  const after = createControllerLightingFrame({
    pins: [
      { state: "idle", selected: false },
      { state: "idle", selected: true },
    ],
  });
  expect(before.slice(0, 2)).toEqual([0xffffff, 0x2e2e2e]);
  expect(after.slice(0, 2)).toEqual([0x2e2e2e, 0xffffff]);
});

it("keeps a selected pin brighter across status colors and the full working pulse", () => {
  const brightness = (rgb: number) =>
    ((rgb >> 16) & 255) * 0.2126 + ((rgb >> 8) & 255) * 0.7152 + (rgb & 255) * 0.0722;
  for (const state of ["idle", "done", "working", "attention", "error", "disconnected"] as const) {
    const frame = (selected: boolean, workingPulseIntensity: number) =>
      createControllerLightingFrame({ pins: [{ state, selected }], workingPulseIntensity })[0]!;
    expect(brightness(frame(true, 0.28))).toBeGreaterThan(brightness(frame(false, 1)) * 2);
  }
});

it("keeps the D3 pin indicator dim blue when pinned and off otherwise", () => {
  expect(createControllerLightingFrame({ pins: [], secondary: { pinOpen: true } })[12]).toBe(
    0x00152c,
  );
  expect(createControllerLightingFrame({ pins: [], secondary: { pinOpen: false } })[12]).toBe(0);
  expect(createControllerLightingFrame({ pins: [] })[12]).toBe(0);
});
