import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
import { ControllerLightingCoordinator } from "./ControllerLightingCoordinator";

const fixture = vi.hoisted(() => ({ status: "running", listeners: new Set<() => void>() }));
vi.mock("../../state/entities", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useThreadShells: () => {
      const status = useSyncExternalStore(
        (listener) => {
          fixture.listeners.add(listener);
          return () => fixture.listeners.delete(listener);
        },
        () => fixture.status,
      );
      return [
        {
          id: "working-pin",
          environmentId: "test-environment",
          createdAt: "2026-10-21T00:00:00Z",
          archivedAt: null,
          lineage: { relationshipToParent: null },
          pinnedAt: "2026-10-21T00:00:00Z",
          runtime: status === "completed" || status === "seen" ? null : { status },
          latestRun: { completedAt: "2026-10-21T01:00:00Z" },
          lastVisitedAt: status === "seen" ? "2026-10-21T02:00:00Z" : "2026-10-21T00:00:00Z",
        },
      ];
    },
  };
});
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    presentationById: new Map([["test-environment", { connection: { phase: "connected" } }]]),
  }),
}));
vi.mock("../../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({ routeThreadRef: null }),
}));
vi.mock("./controllerUiState", () => ({
  useControllerUiSnapshot: () => ({
    pinnedThreads: [{ environmentId: "test-environment", threadId: "working-pin" }],
    secondary: {},
  }),
}));

function setup() {
  fixture.status = "running";
  fixture.listeners.clear();
}

function setStatus(status: string) {
  return act(() => {
    fixture.status = status;
    for (const listener of fixture.listeners) listener();
  });
}

it("changes working pin brightness and stops sending animation frames after idle or unmount", async () => {
  setup();
  using _timers = fakeTimers();
  vi.setSystemTime(0);
  const setLighting = vi.fn(async (_colors: number[]) => {});
  using _bridge = stubGlobal("desktopBridge", { controller: { setLighting } });
  await using screen = await render(<ControllerLightingCoordinator />);
  const dim = setLighting.mock.calls.at(-1)![0][0];
  await act(() => vi.advanceTimersByTime(960));
  const bright = setLighting.mock.calls.at(-1)![0][0];
  expect(bright).toBeGreaterThan(dim!);

  await setStatus("completed");
  expect(setLighting.mock.calls.at(-1)![0][0]).toBe(0x00cc66);
  const idleCount = setLighting.mock.calls.length;
  await act(() => vi.advanceTimersByTime(2_000));
  expect(setLighting).toHaveBeenCalledTimes(idleCount);

  await setStatus("seen");
  expect(setLighting.mock.calls.at(-1)![0][0]).toBe(0xffffff);
  await setStatus("running");
  await screen.unmount();
  const unmountedCount = setLighting.mock.calls.length;
  await act(() => vi.advanceTimersByTime(2_000));
  expect(setLighting).toHaveBeenCalledTimes(unmountedCount);
});

it("does not start a pulse timer in a web client without the controller bridge", async () => {
  setup();
  fixture.status = "completed";
  using _bridge = stubGlobal("desktopBridge", undefined);
  await using _screen = await render(<ControllerLightingCoordinator />);
  using interval = vi.spyOn(window, "setInterval");
  await setStatus("running");
  expect(interval).not.toHaveBeenCalled();
});
