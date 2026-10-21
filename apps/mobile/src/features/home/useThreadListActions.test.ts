import { makeThreadShellFixture } from "../../test-fixtures";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  pendingOrder: null as object | null,
  dropBusy: false,
  scopes: new Map<string, Set<string>>(),
  shells: [] as EnvironmentThreadShell[],
  requests: [] as {
    action: string;
    environmentId: string;
    input: { threadId: string; orderKey?: string };
  }[],
  dialogs: [] as { onConfirm: () => void }[],
  alerts: [] as {
    title: string;
    buttons?: { text: string; onPress?: () => void }[];
  }[],
  afterRequest: undefined as (() => void) | undefined,
  failAction: null as string | null,
  legacyEnvironments: new Set<string>(),
  noSnooze: new Set<string>(),
}));

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("react-native", () => ({
  Alert: {
    alert: (title: string, _message: string, buttons?: { text: string; onPress?: () => void }[]) =>
      state.alerts.push({ title, buttons }),
  },
}));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("../../components/ui/Dialog", () => ({
  alert: (title: string, _message: string, buttons?: { text: string; onPress?: () => void }[]) =>
    state.alerts.push({ title, buttons }),
  confirm: (dialog: { onConfirm: () => void }) => state.dialogs.push(dialog),
}));
vi.mock("../archive/useArchivedThreadSnapshots", () => ({
  refreshArchivedThreadsForEnvironment: () => {},
}));
vi.mock("../../state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    state.scopes.get(environmentId)?.has(scope) === true,
}));
vi.mock("../../state/server", () => ({
  environmentServerConfigsAtom: "server-configs",
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    set: (_atom: string, value: boolean) => {
      state.dropBusy = value;
    },
    get: (atom: string) =>
      atom === "thread-drop-busy"
        ? state.dropBusy
        : atom === "thread-shells"
          ? state.shells
          : atom === "queued-thread-keys"
            ? new Set<string>()
            : new Map(
                [...state.scopes.keys()].map((environmentId) => [
                  environmentId,
                  {
                    environment: {
                      capabilities: {
                        threadSettlement: true,
                        threadSnooze: !state.noSnooze.has(environmentId),
                        threadPinning: true,
                        threadPinReorder: !state.legacyEnvironments.has(environmentId),
                        threadTitleRegeneration: true,
                      },
                    },
                  },
                ]),
              ),
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("../../state/use-thread-outbox", () => ({ queuedThreadKeysAtom: "queued-thread-keys" }));
vi.mock("../../state/thread-order", () => ({
  threadDropBusyAtom: "thread-drop-busy",
  getPendingThreadOrder: () => state.pendingOrder,
  beginPendingThreadOrder: () => {
    state.pendingOrder = {};
    return {
      isPending: () => state.pendingOrder !== null,
      complete: () => {
        state.pendingOrder = null;
      },
      cancel: () => {
        state.pendingOrder = null;
      },
    };
  },
}));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellsAtom: "thread-shells" },
  threadEnvironment: Object.fromEntries(
    [
      "archive",
      "unarchive",
      "delete",
      "settle",
      "unsettle",
      "snooze",
      "unsnooze",
      "pin",
      "unpin",
      "reorderPin",
      "updateMetadata",
    ].map((action) => [
      action,
      async (request: {
        environmentId: string;
        input: { threadId: string; orderKey?: string };
      }) => {
        state.requests.push({ action, ...request });
        if (!state.scopes.get(request.environmentId)?.has(AuthOrchestrationOperateScope)) {
          return AsyncResult.failure(Cause.fail(new Error("Thread operation denied")));
        }
        if (state.failAction === action) {
          return AsyncResult.failure(Cause.fail(new Error("Reorder failed")));
        }
        state.afterRequest?.();
        return AsyncResult.success(undefined);
      },
    ]),
  ),
}));

import { useArchivedThreadListActions, useThreadListActions } from "./useThreadListActions";

const primaryEnvironmentId = EnvironmentId.make("primary");
const otherEnvironmentId = EnvironmentId.make("other");

function makeThread(input: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return makeThreadShellFixture({
    id: ThreadId.make("thread"),
    title: "Thread",
    environmentId: primaryEnvironmentId,
    projectId: ProjectId.make("project"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
    ...input,
  });
}

const mutationCases = [
  ["archiveThread", "archive"],
  ["settleThread", "settle"],
  ["unsettleThread", "unsettle"],
  ["snoozeThread", "snooze"],
  ["unsnoozeThread", "unsnooze"],
  ["pinThread", "pin"],
  ["unpinThread", "unpin"],
  ["regenerateThreadTitle", "updateMetadata"],
] as const;

beforeEach(() => {
  state.pendingOrder = null;
  state.dropBusy = false;
  state.scopes = new Map([
    [primaryEnvironmentId, new Set([AuthOrchestrationOperateScope])],
    [otherEnvironmentId, new Set<string>()],
  ]);
  state.requests = [];
  state.shells = [];
  state.dialogs = [];
  state.alerts = [];
  state.afterRequest = undefined;
  state.failAction = null;
  state.legacyEnvironments.clear();
  state.noSnooze.clear();
});

afterEach(() => vi.unstubAllEnvs());

describe("thread list operation permissions", () => {
  it("appends a fresh pin after the last keyed pin", async () => {
    const thread = makeThread();
    state.shells = [
      makeThread({ id: ThreadId.make("first"), pinnedAt: "2026-09-01", pinOrderKey: "g" }),
      makeThread({ id: ThreadId.make("last"), pinnedAt: "2026-09-01", pinOrderKey: "m" }),
    ];

    expect(await useThreadListActions().pinThread(thread)).toBe(true);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({ action: "pin", input: { threadId: thread.id } });
    expect(state.requests[0]!.input.orderKey! > "m").toBe(true);
  });

  it("keys legacy pins in their displayed tail order before appending a fresh pin", async () => {
    const thread = makeThread();
    state.shells = [
      makeThread({ id: ThreadId.make("keyed"), pinnedAt: "2026-09-01", pinOrderKey: "m" }),
      makeThread({
        id: ThreadId.make("legacy-old"),
        pinnedAt: "2026-09-01",
        pinOrderKey: null,
        createdAt: "2025-01-01",
      }),
      makeThread({
        id: ThreadId.make("legacy-new"),
        pinnedAt: "2026-09-01",
        pinOrderKey: null,
        createdAt: "2026-01-01",
      }),
    ];

    expect(await useThreadListActions().pinThread(thread)).toBe(true);
    expect(state.requests.map(({ action, input }) => [action, input.threadId])).toEqual([
      ["reorderPin", "legacy-new"],
      ["reorderPin", "legacy-old"],
      ["pin", thread.id],
    ]);
    expect(state.requests[0]!.input.orderKey! > "m").toBe(true);
    expect(state.requests[1]!.input.orderKey! > state.requests[0]!.input.orderKey!).toBe(true);
    expect(state.requests[2]!.input.orderKey! > state.requests[1]!.input.orderKey!).toBe(true);
  });

  it("does not issue the fresh pin if legacy pin reordering fails", async () => {
    state.shells = [
      makeThread({ id: ThreadId.make("legacy"), pinnedAt: "2026-09-01", pinOrderKey: null }),
    ];
    state.failAction = "reorderPin";

    expect(await useThreadListActions().pinThread(makeThread())).toBe(false);
    expect(state.requests.map(({ action }) => action)).toEqual(["reorderPin"]);
  });

  it("does not reorder or pin legacy rows when destination permission is absent", async () => {
    state.shells = [
      makeThread({ id: ThreadId.make("legacy"), pinnedAt: "2026-09-01", pinOrderKey: null }),
    ];

    expect(
      await useThreadListActions().pinThread(makeThread({ environmentId: otherEnvironmentId })),
    ).toBe(false);
    expect(state.requests).toEqual([]);
  });

  it("appends after keyed pins on a read-only remote", async () => {
    state.shells = [
      makeThread({ environmentId: otherEnvironmentId, pinnedAt: "now", pinOrderKey: "z" }),
    ];
    expect(await useThreadListActions().pinThread(makeThread())).toBe(true);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]!.input.orderKey! > "z").toBe(true);
  });

  it("routes same-id legacy normalization to each owning environment", async () => {
    state.scopes.get(otherEnvironmentId)!.add(AuthOrchestrationOperateScope);
    state.shells = [
      makeThread({
        environmentId: otherEnvironmentId,
        pinnedAt: "now",
        createdAt: "2026-01-02",
        pinOrderKey: null,
      }),
      makeThread({ pinnedAt: "now", createdAt: "2026-01-01", pinOrderKey: null }),
    ];
    expect(await useThreadListActions().pinThread(makeThread({ id: ThreadId.make("fresh") }))).toBe(
      true,
    );
    expect(state.requests.map(({ environmentId, action }) => [environmentId, action])).toEqual([
      [otherEnvironmentId, "reorderPin"],
      [primaryEnvironmentId, "reorderPin"],
      [primaryEnvironmentId, "pin"],
    ]);
    expect(state.requests[2]!.input.orderKey! > state.requests[1]!.input.orderKey!).toBe(true);
  });

  it.each(["permission", "capability"])(
    "preflights every legacy destination before writes: %s",
    async (reason) => {
      if (reason === "capability") {
        state.scopes.get(otherEnvironmentId)!.add(AuthOrchestrationOperateScope);
        state.legacyEnvironments.add(otherEnvironmentId);
      }
      state.shells = [
        makeThread({ pinnedAt: "now", createdAt: "2026-01-02", pinOrderKey: null }),
        makeThread({
          environmentId: otherEnvironmentId,
          pinnedAt: "now",
          createdAt: "2026-01-01",
          pinOrderKey: null,
        }),
      ];
      expect(
        await useThreadListActions().pinThread(makeThread({ id: ThreadId.make("fresh") })),
      ).toBe(false);
      expect(state.requests).toEqual([]);
    },
  );

  it("stops before pinning after a later normalization fails", async () => {
    state.scopes.get(otherEnvironmentId)!.add(AuthOrchestrationOperateScope);
    state.shells = [
      makeThread({ pinnedAt: "now", createdAt: "2026-01-02", pinOrderKey: null }),
      makeThread({
        environmentId: otherEnvironmentId,
        pinnedAt: "now",
        createdAt: "2026-01-01",
        pinOrderKey: null,
      }),
    ];
    state.afterRequest = () => state.scopes.get(otherEnvironmentId)!.clear();
    expect(await useThreadListActions().pinThread(makeThread({ id: ThreadId.make("fresh") }))).toBe(
      false,
    );
    expect(state.requests.map(({ action }) => action)).toEqual(["reorderPin", "reorderPin"]);
  });

  it("allows a bare first pin on an old server but blocks an unorderable append", async () => {
    state.legacyEnvironments.add(primaryEnvironmentId);
    expect(await useThreadListActions().pinThread(makeThread())).toBe(true);
    expect(state.requests[0]!.input).toEqual({ threadId: "thread" });
    state.requests = [];
    state.shells = [makeThread({ pinnedAt: "now", pinOrderKey: null })];
    expect(await useThreadListActions().pinThread(makeThread({ id: ThreadId.make("fresh") }))).toBe(
      false,
    );
    expect(state.requests).toEqual([]);
  });

  it("ignores archived keyless pins when appending", async () => {
    state.shells = [
      makeThread({
        environmentId: otherEnvironmentId,
        archivedAt: "2026-01-02",
        pinnedAt: "2026-01-01",
        pinOrderKey: null,
      }),
    ];
    expect(await useThreadListActions().pinThread(makeThread())).toBe(true);
    expect(state.requests.map(({ action }) => action)).toEqual(["pin"]);
  });

  it.each(["snoozed", "settled", "subagent"])("ignores a hidden %s keyless pin", async (hidden) => {
    state.legacyEnvironments.add(otherEnvironmentId);
    state.shells = [
      makeThread({
        environmentId: otherEnvironmentId,
        pinnedAt: "now",
        pinOrderKey: null,
        ...(hidden === "snoozed" ? { snoozedUntil: "2099-01-01" } : {}),
        ...(hidden === "settled" ? { settledOverride: "settled" as const } : {}),
        ...(hidden === "subagent"
          ? {
              lineage: {
                rootThreadId: ThreadId.make("root"),
                parentThreadId: ThreadId.make("parent"),
                relationshipToParent: "subagent" as const,
              },
            }
          : {}),
      }),
    ];
    expect(await useThreadListActions().pinThread(makeThread())).toBe(true);
    expect(state.requests.map(({ action }) => action)).toEqual(["pin"]);
  });

  it.each(["unsupported", "woken", "expired"])(
    "includes a visible pin with %s snooze state",
    async (status) => {
      state.legacyEnvironments.add(otherEnvironmentId);
      if (status === "unsupported") state.noSnooze.add(otherEnvironmentId);
      state.shells = [
        makeThread({
          environmentId: otherEnvironmentId,
          pinnedAt: "now",
          pinOrderKey: null,
          snoozedUntil: status === "expired" ? "2020-01-01" : "2099-01-01",
          hasPendingApprovals: status === "woken",
        }),
      ];
      expect(await useThreadListActions().pinThread(makeThread())).toBe(false);
      expect(state.requests).toEqual([]);
    },
  );

  it.each(mutationCases)(
    "%s rejects a retained callback after its environment loses permission",
    async (handler) => {
      const actions = useThreadListActions();
      state.scopes.get(primaryEnvironmentId)!.clear();

      await actions[handler](makeThread(), "2099-01-01T00:00:00.000Z");

      expect(state.requests).toEqual([]);
    },
  );

  it.each(mutationCases)("%s requires the target environment's permission", async (handler) => {
    await useThreadListActions()[handler](
      makeThread({ environmentId: otherEnvironmentId }),
      "2099-01-01T00:00:00.000Z",
    );

    expect(state.requests).toEqual([]);
  });

  it.each(mutationCases)(
    "%s works when the target environment gains only task permission",
    async (handler, action) => {
      state.scopes.get(primaryEnvironmentId)!.clear();
      const actions = useThreadListActions();
      state.scopes.get(otherEnvironmentId)!.add(AuthOrchestrationOperateScope);

      await actions[handler](
        makeThread({ environmentId: otherEnvironmentId }),
        "2099-01-01T00:00:00.000Z",
      );

      expect(state.requests).toEqual([
        expect.objectContaining({ action, environmentId: otherEnvironmentId }),
      ]);
    },
  );

  it("does not show a forbidden delete confirmation", () => {
    useThreadListActions().confirmDeleteThread(makeThread({ environmentId: otherEnvironmentId }));

    expect(state.dialogs).toEqual([]);
    expect(state.alerts.some((alert) => alert.title === "Delete thread?")).toBe(false);
    expect(state.requests).toEqual([]);
  });

  it("rechecks permission after a retained delete confirmation", async () => {
    useThreadListActions().confirmDeleteThread(makeThread());
    const confirm = state.dialogs[0]?.onConfirm;
    expect(confirm).toBeTypeOf("function");
    state.scopes.get(primaryEnvironmentId)!.clear();

    await confirm!();

    expect(state.requests).toEqual([]);
  });

  it("unarchives with only task permission and blocks a later revoked callback", async () => {
    const actions = useArchivedThreadListActions(() => {});
    const thread = makeThread({ archivedAt: "2026-09-02T00:00:00.000Z" });
    await actions.unarchiveThread(thread);
    expect(state.requests).toEqual([expect.objectContaining({ action: "unarchive" })]);
    state.requests = [];
    state.scopes.get(primaryEnvironmentId)!.clear();

    await actions.unarchiveThread(thread);

    expect(state.requests).toEqual([]);
  });

  it("keeps delete independent of terminal and source-control permissions", async () => {
    vi.stubEnv("EXPO_OS", "android");
    useArchivedThreadListActions(() => {}).confirmDeleteThread(makeThread());
    await state.dialogs[0]!.onConfirm();

    expect(state.requests).toEqual([expect.objectContaining({ action: "delete" })]);
  });
});

describe("pinned thread operation permissions", () => {
  it("checks every materialization target before writing any keys", async () => {
    const moved = makeThread({ pinnedAt: "2026-09-02T00:00:00.000Z" });
    state.shells = [
      moved,
      makeThread({
        id: ThreadId.make("other-thread"),
        environmentId: otherEnvironmentId,
        pinnedAt: "2026-09-02T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
      }),
    ];

    expect(await useThreadListActions().moveThread(moved, "up")).toBe(false);
    expect(state.requests).toEqual([]);
  });

  it("moves a keyed thread past a read-only neighbor without writing that neighbor", async () => {
    const moved = makeThread({ pinnedAt: "2026-09-02T00:00:00.000Z", pinOrderKey: "m" });
    state.shells = [
      moved,
      makeThread({
        id: ThreadId.make("other-thread"),
        environmentId: otherEnvironmentId,
        pinnedAt: "2026-09-02T00:00:00.000Z",
        pinOrderKey: "g",
      }),
    ];

    expect(await useThreadListActions().moveThread(moved, "up")).toBe(true);
    expect(state.requests).toEqual([
      expect.objectContaining({ action: "reorderPin", environmentId: primaryEnvironmentId }),
    ]);
  });

  it("rechecks permission between materialization writes", async () => {
    const moved = makeThread({ pinnedAt: "2026-09-02T00:00:00.000Z" });
    state.shells = [
      moved,
      makeThread({
        id: ThreadId.make("other-thread"),
        pinnedAt: "2026-09-02T00:00:00.000Z",
        createdAt: "2026-09-02T00:00:00.000Z",
      }),
    ];
    state.afterRequest = () => state.scopes.get(primaryEnvironmentId)!.clear();

    expect(await useThreadListActions().moveThread(moved, "up")).toBe(false);
    expect(state.requests).toHaveLength(1);
  });
});
