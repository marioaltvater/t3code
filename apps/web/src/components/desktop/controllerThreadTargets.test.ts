import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import { partitionSidebarThreads } from "../Sidebar.threadPartition";
import { WORKING_EXIT_GRACE_MS } from "@t3tools/client-runtime/state/thread-inbox";
import {
  controllerThreadSlotFromCommand,
  controllerThreadTargetFromCommand,
  resolveControllerThreadTargets,
} from "./controllerThreadTargets";
import {
  CONTROLLER_PINNED_LED_INDICES,
  createControllerLightingFrame,
} from "./ControllerLightingCoordinator.logic";

const environmentId = EnvironmentId.make("environment-test");
const now = "2026-10-22T00:00:00.000Z";
function thread(id: string, overrides: ThreadFixtureOverrides = {}) {
  return makeThreadFixture({ id: ThreadId.make(id), environmentId, runtime: null, ...overrides });
}
function partition(
  threads: ReturnType<typeof thread>[],
  options: {
    workingShelfEnabled?: boolean;
    scopedProjectKeys?: ReadonlySet<string>;
    now?: string;
  } = {},
) {
  return partitionSidebarThreads({
    threads,
    scopedProjectKeys: options.scopedProjectKeys ?? null,
    serverConfigs: new Map([
      [
        environmentId,
        {
          environment: {
            capabilities: {
              threadSettlement: true,
              threadSnooze: true,
            },
          },
        } as EnvironmentServerConfig,
      ],
    ]),
    optimisticDrop: null,
    workingShelfEnabled: options.workingShelfEnabled ?? false,
    now: options.now ?? now,
  });
}

it("selects the first six Active shelf rows, excluding parked, pinned, archived and subagent threads", () => {
  const active = Array.from({ length: 8 }, (_, index) =>
    thread(`active-${index + 1}`, {
      activeOrderKey: `a${index}`,
    }),
  );
  const targets = resolveControllerThreadTargets({
    ...partition([
      thread("pin", { pinnedAt: now }),
      thread("settled", { settledOverride: "settled" }),
      thread("snoozed", { snoozedAt: now, snoozedUntil: "2026-10-23T00:00:00.000Z" }),
      thread("archived", { archivedAt: now }),
      thread("child", {
        lineage: {
          relationshipToParent: "subagent",
          parentThreadId: active[0]!.id,
          rootThreadId: active[0]!.id,
        },
      }),
      ...active.toReversed(),
    ]),
    pinnedSections: [],
  });
  expect(targets.activeThreads.map((ref) => ref.threadId)).toEqual(
    active.slice(0, 6).map((thread) => thread.id),
  );
  expect(controllerThreadTargetFromCommand("thread.active.6", targets)?.threadId).toBe("active-6");
});

it("uses the sidebar's environment/project scope and wakes snoozed threads in fallback selection", () => {
  const here = thread("here");
  const elsewhere = thread("elsewhere", { projectId: ProjectId.make("elsewhere") });
  const snoozed = thread("sleep", { snoozedAt: now, snoozedUntil: "2026-10-22T00:00:01.000Z" });
  const scopedProjectKeys = new Set([`${environmentId}:${here.projectId}`]);
  expect(
    partition([here, elsewhere, snoozed], { scopedProjectKeys }).activeThreads.map((t) => t.id),
  ).toEqual([here.id]);
  expect(
    partition([here, elsewhere, snoozed], {
      scopedProjectKeys,
      now: "2026-10-22T00:00:02.000Z",
    }).activeThreads.map((t) => t.id),
  ).toEqual(expect.arrayContaining([here.id, snoozed.id]));
  expect(partition([here, elsewhere]).activeThreads).toHaveLength(2);
});

it("follows Working shelf eligibility and return order across sidebar and fallback rebuilds", () => {
  vi.useFakeTimers();
  using _timers = {
    [Symbol.dispose]() {
      partition([]);
      vi.useRealTimers();
    },
  };
  vi.setSystemTime(Date.parse(now));
  const working = thread("working", { runtime: { status: "running" } as never });
  const idle = thread("idle", { createdAt: "2026-10-21T00:00:00.000Z" });
  partition([working, idle]); // Reset the shared return tracker with the shelf disabled.
  expect(partition([working, idle]).activeThreads).toHaveLength(2);
  expect(
    partition([working, idle], { workingShelfEnabled: true }).activeThreads.map((t) => t.id),
  ).toEqual([idle.id]);
  const returned = { ...working, runtime: null };
  const held = partition([returned, idle], { workingShelfEnabled: true });
  expect(held.activeThreads.map((t) => t.id)).toEqual([idle.id]);
  expect(held.workingThreads.map((t) => t.id)).toEqual([returned.id]);
  vi.advanceTimersByTime(WORKING_EXIT_GRACE_MS);
  expect(
    partition([returned, idle], { workingShelfEnabled: true }).activeThreads.map((t) => t.id),
  ).toEqual([returned.id, idle.id]);
  expect(
    partition([returned, idle], { workingShelfEnabled: true }).activeThreads.map((t) => t.id),
  ).toEqual([returned.id, idle.id]);
});

it("addresses the first section below Pinned in display order even when renamed or collapsed", () => {
  const first = thread("first", { pinnedAt: now, pinOrderKey: "a0" });
  const second = thread("second", { pinnedAt: now, pinOrderKey: "a1" });
  const outside = thread("outside", { pinnedAt: now, pinOrderKey: "Zz" });
  const targets = resolveControllerThreadTargets({
    ...partition([second, outside, first]),
    pinnedSections: [
      {
        id: "chief",
        name: "My renamed section",
        collapsed: true,
        threadKeys: [second, first].map((t) =>
          scopedThreadKey(scopeThreadRef(t.environmentId, t.id)),
        ),
      },
      {
        id: "second-section",
        name: "Chief of Staff",
        collapsed: false,
        threadKeys: [scopedThreadKey(scopeThreadRef(outside.environmentId, outside.id))],
      },
    ],
  });
  expect(targets.chiefOfStaffThreads.map((t) => t.threadId)).toEqual([first.id, second.id]);
  expect(controllerThreadTargetFromCommand("thread.chiefOfStaff.2", targets)?.threadId).toBe(
    second.id,
  );
  expect(controllerThreadTargetFromCommand("thread.chiefOfStaff.3", targets)).toBeNull();
  expect(controllerThreadTargetFromCommand("thread.active.1", targets)).toBeNull();
});

it("does not substitute ordinary pins when the first section or requested position is missing", () => {
  const targets = resolveControllerThreadTargets({
    ...partition([thread("other-pin", { pinnedAt: now })]),
    pinnedSections: [],
  });
  expect(controllerThreadTargetFromCommand("thread.chiefOfStaff.1", targets)).toBeNull();
  expect(controllerThreadTargetFromCommand("thread.active.6", targets)).toBeNull();
});

describe("controller command bounds", () => {
  it.each([
    "thread.pinned.1",
    "thread.jump.1",
    "thread.active.0",
    "thread.active.7",
    "thread.active.01",
    "thread.chiefOfStaff.5",
    "thread.chiefOfStaff.6",
    "thread.chiefOfStaff.4.extra",
  ])("leaves %s to its own handler", (command) => {
    expect(controllerThreadSlotFromCommand(command)).toBeNull();
  });
});

it("keeps missing LED targets dark without shifting later slots or the button selection", () => {
  const targets = {
    activeThreads: ["first", "missing", "third"].map((threadId) => ({ environmentId, threadId })),
    chiefOfStaffThreads: [],
  };
  const frame = createControllerLightingFrame({
    pins: [{ state: "idle", selected: false }, null, { state: "done", selected: true }],
  });
  expect(CONTROLLER_PINNED_LED_INDICES.map((led) => frame[led])).toEqual([
    0x2e2e2e, 0, 0x55ffaa, 0, 0, 0,
  ]);
  expect(controllerThreadTargetFromCommand("thread.active.3", targets)?.threadId).toBe("third");
});
