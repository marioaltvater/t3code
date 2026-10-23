import { makeThreadShellFixture } from "../../test-fixtures";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  pendingOrder: null as object | null,
  dropBusy: false,
  failedAction: null as string | null,
  archivedRefreshes: [] as string[],
  scopes: new Map<string, Set<string>>(),
  shells: [] as EnvironmentThreadShell[],
  requests: [] as {
    action: string;
    environmentId: string;
    input: { threadId: string; orderKey?: string; snoozedUntil?: string; reason?: string };
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
  refreshArchivedThreadsForEnvironment: (environmentId: string) => {
    state.archivedRefreshes.push(environmentId);
  },
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
        if (action === state.failedAction)
          return AsyncResult.failure(Cause.fail(new Error("Server rejected action")));
        state.afterRequest?.();
        return AsyncResult.success(undefined);
      },
    ]),
  ),
}));

import { dismissThreadUndoNotice, readThreadUndoNotice } from "./thread-undo-notice";
import { useThreadListActions } from "./useThreadListActions";

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
  state.failedAction = null;
  state.archivedRefreshes = [];
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

afterEach(() => {
  dismissThreadUndoNotice();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

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

  it("rechecks permission after a retained delete confirmation", async () => {
    useThreadListActions().confirmDeleteThread(makeThread());
    const confirm = state.dialogs[0]?.onConfirm;
    expect(confirm).toBeTypeOf("function");
    state.scopes.get(primaryEnvironmentId)!.clear();

    await confirm!();

    expect(state.requests).toEqual([]);
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

describe("thread action undo", () => {
  it.each([
    ["settleThread", "settle", "Settled", "unsettle"],
    ["snoozeThread", "snooze", "Snoozed", "unsnooze"],
  ] as const)(
    "%s keeps the successful request's undo when a duplicate is rejected",
    async (handler, action, notice, inverse) => {
      const actions = useThreadListActions();
      const thread = makeThread();
      const first = actions[handler](thread, "2099-01-01T09:00:00.000Z");

      expect(await actions[handler](thread, "2099-01-01T09:00:00.000Z")).toBe(false);
      expect(await first).toBe(true);
      expect(state.requests.map(({ action }) => action)).toEqual([action]);
      expect(readThreadUndoNotice()?.action).toBe(notice);
      await readThreadUndoNotice()!.undo();
      expect(state.requests.map(({ action }) => action)).toEqual([action, inverse]);
    },
  );

  it("keeps the latest unpin undo after concurrent unpin requests", async () => {
    const actions = useThreadListActions();
    const thread = makeThread();
    expect(await Promise.all([actions.unpinThread(thread), actions.unpinThread(thread)])).toEqual([
      true,
      true,
    ]);
    expect(readThreadUndoNotice()?.action).toBe("Unpinned");
    await readThreadUndoNotice()!.undo();
    expect(state.requests.map(({ action }) => action)).toEqual(["unpin", "unpin", "pin"]);
  });

  it("rejects a concurrent archive request without sending another mutation", async () => {
    const actions = useThreadListActions();
    const thread = makeThread();
    const first = actions.archiveThread(thread);
    expect(await actions.archiveThread(thread)).toBe(false);
    expect(await first).toBe(true);
    expect(state.requests.map(({ action }) => action)).toEqual(["archive"]);
    expect(state.archivedRefreshes).toEqual([primaryEnvironmentId]);
  });

  it("restores pin placement and snooze after settling, only once", async () => {
    const thread = makeThread({
      pinnedAt: "2026-09-02T00:00:00.000Z",
      pinOrderKey: "m",
      snoozedUntil: "2099-01-01T09:00:00.000Z",
    });
    expect(await useThreadListActions().settleThread(thread)).toBe(true);
    const undo = readThreadUndoNotice()!.undo;
    expect(readThreadUndoNotice()?.action).toBe("Settled");
    await undo();
    await undo();
    expect(state.requests.map(({ action }) => action)).toEqual([
      "settle",
      "unsettle",
      "pin",
      "snooze",
    ]);
    expect(state.requests[2]?.input).toEqual({ threadId: thread.id, orderKey: "m" });
    expect(state.requests[3]?.input).toEqual({
      threadId: thread.id,
      snoozedUntil: thread.snoozedUntil,
    });
    expect(readThreadUndoNotice()).toBeNull();
  });

  // regression: #21401 restore archive and thread action undo
  it("wakes a snoozed thread through the undo action", async () => {
    const thread = makeThread();
    await useThreadListActions().snoozeThread(thread, "2099-01-01T09:00:00.000Z");
    expect(readThreadUndoNotice()?.action).toBe("Snoozed");
    await readThreadUndoNotice()!.undo();
    expect(state.requests.at(-1)).toMatchObject({
      action: "unsnooze",
      environmentId: thread.environmentId,
      input: { threadId: thread.id, reason: "user" },
    });
  });

  it.each([null, "2099-01-01T09:00:00.000Z", "2000-01-01T09:00:00.000Z"])(
    "restores an unpinned thread's previous position and unexpired snooze (%s)",
    async (snoozedUntil) => {
      const thread = makeThread({
        pinnedAt: "2026-09-02T00:00:00.000Z",
        pinOrderKey: "m",
        snoozedUntil,
      });
      await useThreadListActions().unpinThread(thread);
      expect(readThreadUndoNotice()?.action).toBe("Unpinned");
      await readThreadUndoNotice()!.undo();
      // 2099 is the unexpired case; 2000 has long passed.
      const restoresSnooze = snoozedUntil === "2099-01-01T09:00:00.000Z";
      expect(state.requests.map(({ action }) => action)).toEqual(
        restoresSnooze ? ["unpin", "pin", "snooze"] : ["unpin", "pin"],
      );
      expect(state.requests[1]).toMatchObject({
        action: "pin",
        input: { threadId: thread.id, orderKey: "m" },
      });
      if (restoresSnooze) {
        expect(state.requests[2]).toMatchObject({
          action: "snooze",
          environmentId: thread.environmentId,
          input: { threadId: thread.id, snoozedUntil },
        });
      }
    },
  );

  // regression: #21401 restore archive and thread action undo
  it("does not restore snooze if undoing an unpin fails", async () => {
    const thread = makeThread({
      pinnedAt: "2026-09-02T00:00:00.000Z",
      snoozedUntil: "2099-01-01T09:00:00.000Z",
    });
    await useThreadListActions().unpinThread(thread);
    state.failedAction = "pin";
    await readThreadUndoNotice()!.undo();
    expect(state.requests.map(({ action }) => action)).toEqual(["unpin", "pin"]);
  });

  it("invalidates a retained undo when another hook pins the thread", async () => {
    const thread = makeThread();
    await useThreadListActions().unpinThread(thread);
    const undo = readThreadUndoNotice()!.undo;
    await useThreadListActions().pinThread(thread);
    await undo();
    expect(state.requests.map(({ action }) => action)).toEqual(["unpin", "pin"]);
    expect(readThreadUndoNotice()).toBeNull();
  });

  // regression: #21401 restore archive and thread action undo
  it("does not offer undo for a failed action", async () => {
    state.failedAction = "settle";
    expect(await useThreadListActions().settleThread(makeThread())).toBe(false);
    expect(readThreadUndoNotice()).toBeNull();
  });

  it("stops restoring after a failed inverse command", async () => {
    const thread = makeThread({
      pinnedAt: "2026-09-02T00:00:00.000Z",
      snoozedUntil: "2099-01-01T09:00:00.000Z",
    });
    await useThreadListActions().settleThread(thread);
    state.failedAction = "unsettle";
    await readThreadUndoNotice()!.undo();
    expect(state.requests.map(({ action }) => action)).toEqual(["settle", "unsettle"]);
    expect(state.alerts.at(-1)?.title).toBe("Could not un-settle thread");
  });

  it("rechecks the destination permission before undoing", async () => {
    await useThreadListActions().unpinThread(makeThread());
    state.scopes.get(primaryEnvironmentId)!.clear();
    await readThreadUndoNotice()!.undo();
    expect(state.requests.map(({ action }) => action)).toEqual(["unpin"]);
  });

  // regression: #21401 restore archive and thread action undo
  it("expires undo after five seconds", async () => {
    vi.useFakeTimers();
    await useThreadListActions().unpinThread(makeThread());
    const undo = readThreadUndoNotice()!.undo;
    vi.advanceTimersByTime(5_000);
    expect(readThreadUndoNotice()).toBeNull();
    await undo();
    expect(state.requests.map(({ action }) => action)).toEqual(["unpin"]);
  });

  // regression: #21401 restore archive and thread action undo
  it("refreshes the archive after archiving on a settlement-capable server", async () => {
    await useThreadListActions().archiveThread(makeThread());
    expect(state.requests.map(({ action }) => action)).toEqual(["archive"]);
    expect(state.archivedRefreshes).toEqual([primaryEnvironmentId]);
  });
});

describe("thread archive guard", () => {
  it("keeps active provider runs out of the archive", async () => {
    const thread = makeThread({
      runtime: {
        status: "running",
        activeRunId: RunId.make("active-run"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: "codex",
        lastError: null,
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    });
    expect(await useThreadListActions().archiveThread(thread)).toBe(false);
    expect(state.requests).toEqual([]);
    expect(state.archivedRefreshes).toEqual([]);
    expect(state.alerts.at(-1)?.title).toBe("Could not archive thread");
  });
});
