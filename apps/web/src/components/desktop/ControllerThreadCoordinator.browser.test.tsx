import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { makeThreadFixture } from "../../test-fixtures";
import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
import { publishControllerThreadTargets } from "./controllerUiState";
import { ControllerThreadCoordinator } from "./ControllerThreadCoordinator";

const fixture = vi.hoisted(() => ({
  threads: [] as EnvironmentThreadShell[],
  workingShelfEnabled: false,
  configs: new Map([
    [
      "test-environment",
      { environment: { capabilities: { threadSnooze: true, threadSettlement: true } } },
    ],
  ]),
  bindings: [] as ReturnType<typeof compileResolvedKeybindingsConfig>,
}));
vi.mock("../../state/server", () => ({
  environmentServerConfigsAtom: "configs",
  primaryServerKeybindingsAtom: "keybindings",
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: string) => (atom === "configs" ? fixture.configs : fixture.bindings),
}));
vi.mock("../../state/entities", () => ({ useThreadShells: () => fixture.threads }));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: () => fixture.workingShelfEnabled,
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    presentationById: new Map([["test-environment", { connection: { phase: "connected" } }]]),
  }),
}));
vi.mock("../../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({ routeThreadRef: null }),
}));

function setup() {
  fixture.threads = [];
  fixture.workingShelfEnabled = false;
  fixture.bindings = compileResolvedKeybindingsConfig([
    { key: "alt+2", command: "thread.active.2" },
  ]);
  publishControllerThreadTargets(null);
  useThreadSelectionStore.getState().clearSelection();
  useUiStateStore.setState({ sidebarPinnedSections: [], threadLastVisitedAtById: {} });
}

function thread(id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make("test-environment"),
    runtime: null,
    ...overrides,
  });
}

function bridge() {
  const listeners = new Set<(action: string) => void>();
  const setLighting = vi.fn(async (_colors: number[]) => {});
  const onMenuAction = vi.fn((listener: (action: string) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  return { listeners, setLighting, onMenuAction, controller: { setLighting } };
}

it("routes Settings controls using Active fallback and named pins, with vacant slots as no-ops", async () => {
  setup();
  const first = thread("first", { activeOrderKey: "a0" });
  const second = thread("second", { activeOrderKey: "a1", hasPendingApprovals: true });
  const chief = thread("chief", { pinnedAt: "2026-10-22T00:00:00Z" });
  fixture.threads = [chief, second, thread("settled", { settledOverride: "settled" }), first];
  useUiStateStore.setState({
    sidebarPinnedSections: [
      {
        id: "chief",
        name: "First custom section",
        collapsed: true,
        threadKeys: ["test-environment:chief"],
      },
    ],
  });
  const device = bridge();
  using _bridge = stubGlobal("desktopBridge", device);
  await using screen = await render(<ControllerThreadCoordinator />, { router: "/settings" });
  expect(device.onMenuAction).toHaveBeenCalledTimes(1);
  expect(device.setLighting.mock.calls.at(-1)![0].slice(0, 3)).toEqual([0x2e2e2e, 0x2e1400, 0]);
  const command = (action: string) =>
    act(() => {
      for (const listener of device.listeners) listener(action);
    });
  await command("thread.active.2");
  expect(screen.router!.state.location.pathname).toBe("/test-environment/second");
  await command("thread.active.6");
  expect(screen.router!.state.location.pathname).toBe("/test-environment/second");
  await command("thread.chiefOfStaff.1");
  expect(screen.router!.state.location.pathname).toBe("/test-environment/chief");
  await command("thread.chiefOfStaff.4");
  await command("thread.pinned.1"); // Ordinary pin navigation has its own existing handler.
  expect(screen.router!.state.location.pathname).toBe("/test-environment/chief");
  await screen.unmount();
  expect(device.listeners.size).toBe(0);
});

it("maps only Active when Chief of Staff and Simmer pins appear above its single thread", async () => {
  setup();
  const chiefs = ["main", "loomia", "iot", "talos"].map((id, index) =>
    thread(id, { pinnedAt: "2026-10-22T00:00:00Z", pinOrderKey: `a${index}` }),
  );
  const simmer = thread("simmer", { pinnedAt: "2026-10-22T00:00:00Z", pinOrderKey: "a4" });
  fixture.threads = [
    ...chiefs,
    simmer,
    thread("active"),
    thread("settled", { settledOverride: "settled" }),
  ];
  useUiStateStore.setState({
    sidebarPinnedSections: [
      {
        id: "chief",
        name: "Chief of Staff",
        collapsed: false,
        threadKeys: chiefs.map((t) => `test-environment:${t.id}`),
      },
      { id: "simmer", name: "Simmer", collapsed: false, threadKeys: ["test-environment:simmer"] },
    ],
  });
  const device = bridge();
  using _bridge = stubGlobal("desktopBridge", device);
  await using screen = await render(<ControllerThreadCoordinator />);
  const colors = device.setLighting.mock.calls.at(-1)![0];
  expect([0, 1, 2, 5, 6, 7].map((index) => colors[index])).toEqual([0x2e2e2e, 0, 0, 0, 0, 0]);
  for (let slot = 1; slot <= 6; slot++) {
    await act(() => {
      for (const listener of device.listeners) listener(`thread.active.${slot}`);
    });
    expect(screen.router!.state.location.pathname).toBe("/test-environment/active");
  }
  for (let slot = 1; slot <= 4; slot++) {
    await act(() => {
      for (const listener of device.listeners) listener(`thread.chiefOfStaff.${slot}`);
    });
    expect(screen.router!.state.location.pathname).toBe(
      `/test-environment/${chiefs[slot - 1]!.id}`,
    );
  }
});

it.each([
  { input: "controller", shelf: "active", target: "active" },
  { input: "keyboard", shelf: "active", target: "active" },
  { input: "controller", shelf: "chiefOfStaff", target: "chief" },
  { input: "keyboard", shelf: "chiefOfStaff", target: "chief" },
])(
  "clears selection and anchors $input navigation to $shelf, preserving it for vacant slots",
  async ({ input, shelf, target }) => {
    setup();
    fixture.threads = [thread("active"), thread("chief", { pinnedAt: "2026-10-22T00:00:00Z" })];
    useUiStateStore.setState({
      sidebarPinnedSections: [
        {
          id: "chief",
          name: "Chief of Staff",
          collapsed: false,
          threadKeys: ["test-environment:chief"],
        },
      ],
    });
    fixture.bindings = compileResolvedKeybindingsConfig([
      { key: "alt+1", command: shelf === "active" ? "thread.active.1" : "thread.chiefOfStaff.1" },
    ]);
    const device = bridge();
    using _bridge = stubGlobal("desktopBridge", device);
    await using screen = await render(<ControllerThreadCoordinator />);
    await act(() => {
      useThreadSelectionStore.getState().toggleThread("test-environment:old-a");
      useThreadSelectionStore.getState().toggleThread("test-environment:old-b");
      for (const listener of device.listeners) listener("thread.active.6");
    });
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(2);
    expect(useThreadSelectionStore.getState().anchorThreadKey).toBe("test-environment:old-b");
    await act(() => {
      if (input === "keyboard") {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "1", altKey: true, cancelable: true }),
        );
      } else {
        for (const listener of device.listeners) listener(`thread.${shelf}.1`);
      }
    });
    expect(screen.router!.state.location.pathname).toBe(`/test-environment/${target}`);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
    expect(useThreadSelectionStore.getState().anchorThreadKey).toBe(`test-environment:${target}`);
  },
);

it("uses the sidebar's published scope and order for both keyboard navigation and LEDs without compacting holes", async () => {
  setup();
  fixture.threads = [
    thread("outside"),
    thread("second", { hasPendingUserInput: true }),
    thread("first"),
  ];
  const device = bridge();
  using _bridge = stubGlobal("desktopBridge", device);
  await using screen = await render(<ControllerThreadCoordinator />);
  await act(() =>
    publishControllerThreadTargets({
      activeThreads: ["second", "missing", "first"].map((threadId) => ({
        environmentId: "test-environment",
        threadId,
      })),
      chiefOfStaffThreads: [],
    }),
  );
  expect(device.setLighting.mock.calls.at(-1)![0].slice(0, 3)).toEqual([0x2e1400, 0, 0x2e2e2e]);
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", altKey: true, cancelable: true }),
    ),
  );
  expect(screen.router!.state.location.pathname).toBe("/");
  await act(() => {
    for (const listener of device.listeners) listener("thread.active.3");
  });
  expect(screen.router!.state.location.pathname).toBe("/test-environment/first");
  expect(device.onMenuAction).toHaveBeenCalledTimes(1);
  await act(() =>
    publishControllerThreadTargets({
      activeThreads: [{ environmentId: "test-environment", threadId: "second" }],
      chiefOfStaffThreads: [],
    }),
  );
  fixture.bindings = compileResolvedKeybindingsConfig([
    { key: "alt+2", command: "thread.active.1" },
  ]);
  await screen.rerender(<ControllerThreadCoordinator />);
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", altKey: true, cancelable: true }),
    ),
  );
  expect(screen.router!.state.location.pathname).toBe("/test-environment/second");
});

it("wakes Settings fallback and updates button selection and lighting together", async () => {
  setup();
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
  fixture.threads = [
    thread("sleeper", { snoozedAt: "2026-10-22T00:00:00Z", snoozedUntil: "2026-10-22T00:00:01Z" }),
  ];
  const device = bridge();
  using _bridge = stubGlobal("desktopBridge", device);
  await using screen = await render(<ControllerThreadCoordinator />, { router: "/settings" });
  expect(device.setLighting.mock.calls.at(-1)![0][0]).toBe(0);
  await act(() => vi.advanceTimersByTime(1_050));
  expect(device.setLighting.mock.calls.at(-1)![0][0]).toBeGreaterThan(0);
  await act(() => {
    for (const listener of device.listeners) listener("thread.active.1");
  });
  expect(screen.router!.state.location.pathname).toBe("/test-environment/sleeper");
});
