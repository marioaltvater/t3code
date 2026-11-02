import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as SymphonyBusGateway from "./SymphonyBusGateway.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  ProviderInstanceId,
  ThreadId,
  SymphonyParticipation,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { DispatchModeLimit } from "../orchestration-v2/DispatchModeLimit.ts";
import { McpSchema, McpServer } from "effect/ai";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { OrchestratorToolkit } from "../mcp/toolkits/orchestrator/tools.ts";
import { toolkitRegistration } from "../mcp/McpHttpServer.ts";
import * as ThreadMetadata from "../mcp/ThreadMetadataMcpService.ts";
import * as Handlers from "../mcp/toolkits/orchestrator/handlers.ts";
import * as OrchestratorService from "../mcp/OrchestratorMcpService.ts";
import * as Participation from "./ThreadParticipationService.ts";
import * as Control from "./ThreadParticipationControl.ts";

const decodeParticipation = Schema.decodeUnknownEffect(SymphonyParticipation);

const threadId = ThreadId.make("chief");
const ownerId = ThreadId.make("owner");
const environmentId = EnvironmentId.make("actual-environment");
const shell = (id: typeof threadId) =>
  id === "missing"
    ? null
    : {
        ...McpToolAccessTestkit.liveThreadShell(id),
        deletedAt: id === "deleted" ? DateTime.makeUnsafe("2026-01-01T00:00:00Z") : null,
        archivedAt: id === "archived" ? DateTime.makeUnsafe("2026-01-01T00:00:00Z") : null,
      };
const controlLayer = (readShell = shell) =>
  Control.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Participation.layer,
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: (id) =>
            Effect.suspend(() => {
              const record = readShell(id);
              return record
                ? Effect.succeed(McpToolAccessTestkit.idleThreadProjection(record).thread)
                : Effect.fail(
                    new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId: id }),
                  );
            }),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(environmentId),
        }),
      ),
    ),
    Layer.provideMerge(Sqlite.layerMemory),
  );

const layer = controlLayer();

it.effect("binds requests to the server environment and validates the target conversation", () =>
  Effect.gen(function* () {
    const service = yield* Control.ThreadParticipationControl;
    assert.equal((yield* service.status({ threadId })).desiredState, "left");
    const joined = yield* service.join({
      threadId,
      identity: "v12:alice:orchestrator",
      topics: ["graph:2607"],
      expectedGeneration: 0,
      clientRequestId: "join",
    });
    assert.equal(joined.environmentId, environmentId);
    assert.equal(joined.pendingReason, "native_reconfigure_required");
    assert.equal((yield* service.status({ threadId: ownerId })).desiredState, "left");
    for (const id of ["missing", "archived"]) {
      const error = yield* service
        .join({
          threadId: ThreadId.make(id),
          identity: "v12:alice:reviewer",
          topics: [],
          expectedGeneration: 0,
          clientRequestId: "join",
        })
        .pipe(Effect.flip);
      assert.equal(error.code, "invalid");
    }
    const left = yield* service.leave({
      threadId,
      expectedGeneration: 1,
      clientRequestId: "leave",
    });
    assert.equal(left.desiredState, "left");
  }).pipe(Effect.provide(layer)),
);

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId,
  requestNamespace: "participation-test",
  issuedAt: 0,
  thread: {
    threadId,
    providerSessionId: "provider",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "fixture", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  },
  getClient: Effect.die("unused"),
});

it.effect(
  "uses the same durable intent from MCP, defaults to caller, and refuses read-only writes",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const call = (arguments_: Record<string, unknown>, invocation = scope) =>
        server
          .callTool({ name: "t3_symphony_participation", arguments: arguments_ })
          .pipe(
            Effect.provideService(McpSchema.McpServerClient, client),
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          );
      const initial = yield* call({ action: "status" });
      assert.equal(initial.isError, false);
      assert.equal((yield* decodeParticipation(initial.structuredContent)).desiredGeneration, 0);
      const invalid = yield* call({
        action: "join",
        identity: "v12:alice:orchestrator",
        topics: [],
        expectedGeneration: 0,
      });
      assert.equal(invalid.isError, true);
      assert.equal(
        (yield* (yield* Control.ThreadParticipationControl).status({ threadId })).desiredGeneration,
        0,
      );
      const joined = yield* call({
        action: "join",
        identity: "v12:alice:orchestrator",
        topics: ["agent:loomia-cos"],
        expectedGeneration: 0,
        clientRequestId: "mcp-join",
      });
      assert.equal(joined.isError, false);
      assert.equal(
        (yield* decodeParticipation(joined.structuredContent)).pendingReason,
        "native_reconfigure_required",
      );
      const external = {
        ...scope,
        thread: undefined,
        client: { sessionId: "client", label: "client", access: "read-only" as const },
      };
      assert.equal((yield* call({ action: "status" }, external)).isError, true);
      assert.equal((yield* call({ action: "status", threadId }, external)).isError, false);
      const refused = yield* call(
        { action: "leave", threadId, expectedGeneration: 1, clientRequestId: "denied-leave" },
        external,
      );
      assert.equal(refused.isError, true);
      const lower = {
        ...external,
        client: { ...external.client, access: "approval-required" as const },
      };
      const deletedRefused = yield* call(
        {
          action: "leave",
          threadId: "deleted",
          expectedGeneration: 0,
          clientRequestId: "lower-deleted",
        },
        lower,
      );
      assert.equal(deletedRefused.isError, true);
      assert.equal(
        (yield* (yield* Control.ThreadParticipationControl).status({
          threadId: ThreadId.make("deleted"),
        })).desiredGeneration,
        0,
      );

      const status = yield* (yield* Control.ThreadParticipationControl).status({ threadId });
      assert.equal(status.desiredState, "joined");
      assert.equal(status.desiredGeneration, 1);
      assert.equal(
        (yield* (yield* Control.ThreadParticipationControl).status({ threadId: ownerId }))
          .desiredState,
        "left",
      );
    }).pipe(
      Effect.provide(
        toolkitRegistration(OrchestratorToolkit, Handlers.layer).pipe(
          Layer.provide(Layer.mock(McpSessionRegistry.McpSessionRegistry)({})),
          Layer.provide(McpProviderSessions.layer),
          Layer.provide(Layer.mock(SymphonyBusGateway.SymphonyBusGateway)({})),
          Layer.provideMerge(McpServer.McpServer.layer),
          Layer.provide(NodeCrypto.layer),
          Layer.provideMerge(layer),
          Layer.provide(Layer.mock(ThreadMetadata.ThreadMetadataMcpService)({})),
          Layer.provide(Layer.mock(OrchestratorService.OrchestratorMcpService)({})),
          Layer.provide(
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: (id) => Effect.succeed(shell(id)),
            }),
          ),
        ),
      ),
    ),
);

// P2-03: removing the thread projection must not strand durable identity ownership.
it.effect("allows protected status and leave recovery after conversation deletion", () => {
  let deleted = false;
  return Effect.gen(function* () {
    const service = yield* Control.ThreadParticipationControl;
    yield* service.join({
      threadId,
      identity: "v12:alice:orchestrator",
      topics: [],
      clientRequestId: "before-delete",
      expectedGeneration: 0,
    });
    deleted = true;
    assert.equal((yield* service.status({ threadId })).desiredState, "joined");
    const left = yield* service.leave({
      threadId,
      clientRequestId: "recover-delete",
      expectedGeneration: 1,
    });
    assert.equal(left.desiredState, "left");
    assert.equal(left.appliedGeneration, left.desiredGeneration);
    const replacement = yield* service.join({
      threadId: ownerId,
      identity: "v12:alice:orchestrator",
      topics: [],
      clientRequestId: "reuse",
      expectedGeneration: 0,
    });
    assert.equal(replacement.desiredState, "joined");
    assert.equal(
      (yield* service
        .join({
          threadId,
          identity: "v12:alice:reviewer",
          topics: [],
          clientRequestId: "deleted-rejoin",
          expectedGeneration: 2,
        })
        .pipe(Effect.flip)).code,
      "invalid",
    );
  }).pipe(Effect.provide(controlLayer((id) => (deleted && id === threadId ? null : shell(id)))));
});

// P2-06: production shell reads hide deleted rows; authorization must use durable thread modes.
it.effect(
  "fences deleted-target recovery against real projection modes without writing a receipt",
  () =>
    Effect.gen(function* () {
      const service = yield* Control.ThreadParticipationControl;
      const projection = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const target = McpToolAccessTestkit.idleThreadProjection(
        McpToolAccessTestkit.liveThreadShell(threadId),
      ).thread;
      yield* projection.apply({
        id: EventId.make("created"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: target,
      });
      yield* service.join({
        threadId,
        identity: "v12:alice:orchestrator",
        topics: [],
        expectedGeneration: 0,
        clientRequestId: "before-real-delete",
      });
      yield* projection.apply({
        id: EventId.make("deleted"),
        type: "thread.deleted",
        threadId,
        occurredAt: now,
        payload: { ...target, deletedAt: now },
      });
      assert.equal(yield* projection.getThreadShell(threadId), null);
      assert.equal((yield* projection.getThread(threadId)).runtimeMode, "full-access");
      const denied = yield* service
        .leave({ threadId, expectedGeneration: 1, clientRequestId: "denied-real-delete" })
        .pipe(
          Effect.provideService(DispatchModeLimit, {
            runtimeMode: "approval-required",
            interactionMode: "default",
          }),
          Effect.flip,
        );
      assert.equal(denied.code, "forbidden");
      assert.equal((yield* service.status({ threadId })).desiredGeneration, 1);
      assert.equal(
        (yield* sql`SELECT 1 FROM symphony_participation_requests WHERE client_request_id = ${"denied-real-delete"}`)
          .length,
        0,
      );
      const recovered = yield* service
        .leave({ threadId, expectedGeneration: 1, clientRequestId: "authorized-real-delete" })
        .pipe(
          Effect.provideService(DispatchModeLimit, {
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        );
      assert.equal(recovered.desiredState, "left");
    }).pipe(
      Effect.provide(
        Control.layer.pipe(
          Layer.provideMerge(
            Layer.merge(ProjectionStore.layer, Participation.layer).pipe(
              Layer.provideMerge(Sqlite.layerMemory),
            ),
          ),
          Layer.provide(
            Layer.mock(ServerEnvironment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed(environmentId),
            }),
          ),
        ),
      ),
    ),
);
