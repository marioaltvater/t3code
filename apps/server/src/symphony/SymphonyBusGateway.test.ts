import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as NetAddress from "effect/net/NetAddress";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/ai";
import { toolkitRegistration } from "../mcp/McpHttpServer.ts";
import { OrchestratorToolkit } from "../mcp/toolkits/orchestrator/tools.ts";
import * as Handlers from "../mcp/toolkits/orchestrator/handlers.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadMetadata from "../mcp/ThreadMetadataMcpService.ts";
import * as OrchestratorService from "../mcp/OrchestratorMcpService.ts";
import * as Control from "./ThreadParticipationControl.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  SymphonyBusResult,
  EnvironmentId,
  ProviderSessionId,
  RunId,
  ThreadId,
  type SymphonyBusConfiguration,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { FetchHttpClient, HttpServer } from "effect/http";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Participation from "./ThreadParticipationService.ts";
import * as Gateway from "./SymphonyBusGateway.ts";
import * as Delivery from "./SymphonyDeliveryService.ts";
import * as Transport from "./SymphonyBusTransport.ts";

const endpoint = "http://127.0.0.1:9999/private-mcp";
const environmentId = EnvironmentId.make("fixture-environment");
const a = {
  environmentId,
  threadId: ThreadId.make("coordinator"),
  mcpCredentialId: "credential-A",
  authorization: Effect.void,
};
const b = {
  environmentId,
  threadId: ThreadId.make("owner"),
  mcpCredentialId: "credential-B",
  authorization: Effect.void,
};
const identityA = "v12:alice:orchestrator";
const identityB = "v12:alice:implementer:42";
const topics = new Map([
  [identityA, ["graph:github-7"]],
  [identityB, ["issue:github-42"]],
]);

function fixture(
  options: {
    protocolVersion?: string;
    pauseWho?: { arrived: () => void; release: Promise<void> };
    pausePublish?: { arrived: () => void; release: Promise<void> };
    extraTopics?: string[];
    wrongWho?: boolean;
    pauseInbox?: { arrived: () => void; release: Promise<void> };
    configuration?: () => SymphonyBusConfiguration | null;
  } = {},
) {
  const calls: Array<{
    method: string;
    identity: string;
    principal: string | null;
    args: Record<string, unknown>;
  }> = [];
  const deliveries = new Map<string, Array<Record<string, unknown>>>();
  const publications = new Map<string, Record<string, unknown>>();
  let seq = 0;
  let closes = 0;
  let networkGets = 0;
  const allocated = new Set<string>();
  const cleanup: Array<{ aborted: boolean; identity: string | null; session: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    if (init?.method === "GET") {
      networkGets += 1;
      return new Response(null, { status: 405 });
    }
    if (init?.method === "DELETE") {
      const h = new Headers(init.headers);
      cleanup.push({
        aborted: init.signal?.aborted ?? false,
        identity: h.get("X-Symphony-Agent-Id"),
        session: h.get("Mcp-Session-Id"),
      });
      if (init.signal?.aborted) throw new DOMException("Fixture aborted request", "AbortError");
      allocated.delete(h.get("Mcp-Session-Id") ?? "");
      closes += 1;
      return new Response(null, { status: 200 });
    }
    const request = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    const identity = headers.get("X-Symphony-Agent-Id") ?? "MISSING";
    const principal = headers.get("X-Symphony-Principal");
    if (!Object.hasOwn(request, "id")) return new Response(null, { status: 202 });
    let result: unknown;
    if (request.method === "initialize") {
      allocated.add(`session-${identity}`);
      result = {
        protocolVersion: options.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    } else if (request.method === "tools/list") result = { tools: [] };
    else {
      const tool = request.params.name;
      const args = request.params.arguments ?? {};
      calls.push({ method: tool, identity, principal, args });
      let payload: Record<string, unknown>;
      if (tool === "symphony_whoami") {
        payload = {
          identity: {
            agent_id: options.wrongWho ? "codex:shared" : identity,
            principal,
            kind: "codex",
            declared: true,
            declaration_error: null,
          },
          bus: {
            subscriptions: [
              ...(topics.get(identity) ?? []),
              "agents",
              "broadcast",
              ...(options.extraTopics ?? []),
            ],
          },
        };
        options.pauseWho?.arrived();
        if (options.pauseWho) await options.pauseWho.release;
      } else if (tool === "symphony_inbox") {
        options.pauseInbox?.arrived();
        if (options.pauseInbox) await options.pauseInbox.release;
        const events = (deliveries.get(identity) ?? []).filter(
          (event) => Number(event.seq) > Number(args.after_seq ?? 0),
        );
        payload = {
          agent_id: identity,
          events,
          acked_seq: 0,
          next_seq: Math.max(Number(args.after_seq ?? 0), seq),
          head_seq: seq,
          gap: false,
        };
      } else {
        const key = `${identity}:${args.idempotency_key}`;
        let event = publications.get(key);
        if (!event) {
          event = {
            seq: ++seq,
            from: { agent_id: identity },
            type: args.type,
            topics: args.topics,
            body: args.body,
          };
          publications.set(key, event);
          for (const recipient of args.deliver_to ?? [])
            deliveries.set(recipient, [...(deliveries.get(recipient) ?? []), event]);
        }
        payload = { event };
        options.pausePublish?.arrived();
        if (options.pausePublish) await options.pausePublish.release;
      }
      result = { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false };
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": `session-${identity}` },
    });
  };
  const layer = Gateway.layer.pipe(
    Layer.provideMerge(
      Layer.merge(
        Participation.layer,
        Transport.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
      ),
    ),
    Layer.provideMerge(Sqlite.layerMemory),
    Layer.provide(
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.sync(() => ({
          ...DEFAULT_SERVER_SETTINGS,
          symphonyBus: options.configuration ? options.configuration() : { endpoint },
        })),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(environmentId),
      }),
    ),
  );
  return { layer, calls, closes: () => closes, networkGets: () => networkGets, allocated, cleanup };
}

const admit = Effect.fn("fixture.admit")(function* (caller: typeof a, identity: string) {
  const service = yield* Participation.ThreadParticipationService;
  const joined = yield* service.join({
    ...caller,
    identity,
    topics: topics.get(identity) ?? [],
    expectedGeneration: 0,
    clientRequestId: "join",
  });
  const reserved = yield* service.reserveNative({
    ...caller,
    expectedGeneration: joined.desiredGeneration,
  });
  return yield* service.applied({
    ...caller,
    expectedGeneration: joined.desiredGeneration,
    nativeGeneration: reserved.nativeGeneration,
    binding: {
      kind: "native-mcp",
      nativeThreadId: `native-${caller.threadId}`,
      nativeSessionId: `hook-${caller.threadId}`,
      providerSessionId: ProviderSessionId.make(`runtime-${caller.threadId}`),
      mcpCredentialId: caller.mcpCredentialId,
      configurationRevision: Gateway.symphonyBusConfigurationRevision({ endpoint }),
      nativeGeneration: reserved.nativeGeneration,
    },
  });
});

it.effect(
  "unknown, pending and app-owned child conversations make zero bus requests or cursor writes",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const gateway = yield* Gateway.SymphonyBusGateway;
      const quiet = yield* gateway.call(a, { operation: "inbox" });
      assert.equal(quiet.state, "quiet");
      const service = yield* Participation.ThreadParticipationService;
      yield* service.join({
        ...a,
        identity: identityA,
        topics: topics.get(identityA)!,
        expectedGeneration: 0,
        clientRequestId: "join",
      });
      assert.equal((yield* gateway.call(a, { operation: "inbox" })).state, "pending");
      const child = {
        ...a,
        threadId: ThreadId.make("app-owned-child"),
        mcpCredentialId: "child-credential",
      };
      assert.equal((yield* gateway.call(child, { operation: "inbox" })).state, "quiet");
      assert.equal(f.calls.length, 0);
      assert.equal(
        (yield* (yield* SqlClient.SqlClient)`SELECT 1 FROM symphony_thread_participation`).length,
        1,
      );
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("isolates two native credentials, identities, scopes and read-only checkpoints", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const gateway = yield* Gateway.SymphonyBusGateway;
    yield* admit(a, identityA);
    yield* admit(b, identityB);
    assert.equal(
      (yield* gateway.call(a, { operation: "inbox", afterSeq: 11 })).identity,
      identityA,
    );
    assert.equal(
      (yield* gateway.call(b, { operation: "inbox", afterSeq: 22 })).identity,
      identityB,
    );
    assert.deepEqual(
      f.calls
        .filter((c) => c.method === "symphony_inbox")
        .map((c) => [c.identity, c.principal, c.args.after_seq, c.args.ack]),
      [
        [identityA, "alice", 11, false],
        [identityB, "alice", 22, false],
      ],
    );
    assert.equal(f.closes(), 2);
    const before = f.calls.length;
    assert.equal(
      (yield* gateway
        .call({ ...a, mcpCredentialId: b.mcpCredentialId }, { operation: "inbox" })
        .pipe(Effect.flip)).code,
      "revoked",
    );
    assert.equal(f.calls.length, before);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "routes an explicit direct handoff once with the same key across an uncertain retry",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const gateway = yield* Gateway.SymphonyBusGateway;
      yield* admit(a, identityA);
      yield* admit(b, identityB);
      const publication = {
        type: "handoff",
        subject: "Review result",
        body: "Private fixture handoff.",
        topics: [`agent:${identityB}`],
        deliverTo: [identityB],
        idempotencyKey: "handoff-stable-1",
      };
      yield* gateway.call(a, { operation: "publish", publication });
      yield* gateway.call(a, { operation: "publish", publication });
      const owner = yield* gateway.call(b, { operation: "inbox", afterSeq: 0 });
      assert.equal(owner.state, "ready");
      assert.deepEqual(
        (owner.payload as { events: Array<{ from: { agent_id: string } }> }).events.map(
          (e) => e.from.agent_id,
        ),
        [identityA],
      );
      const sender = yield* gateway.call(a, { operation: "inbox", afterSeq: 0 });
      assert.equal((sender.payload as { events: unknown[] }).events.length, 0);
      const before = f.calls.length;
      assert.equal(
        (yield* gateway
          .call(a, {
            operation: "publish",
            publication: { ...publication, topics: ["repo:unrelated"] },
          })
          .pipe(Effect.flip)).code,
        "forbidden",
      );
      assert.equal(f.calls.length, before);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("refuses wrong identity and broader subscriptions before inbox admission", () =>
  Effect.gen(function* () {
    for (const options of [{ wrongWho: true }, { extraTopics: ["repo:unrelated"] }]) {
      const f = fixture(options);
      yield* Effect.gen(function* () {
        yield* admit(a, identityA);
        const error = yield* (yield* Gateway.SymphonyBusGateway)
          .call(a, { operation: "inbox" })
          .pipe(Effect.flip);
        assert.equal(error.code, options.wrongWho ? "identity_mismatch" : "scope_mismatch");
        assert.deepEqual(
          f.calls.map((c) => c.method),
          ["symphony_whoami"],
        );
        assert.equal(f.closes(), 1);
      }).pipe(Effect.provide(f.layer));
    }
  }),
);

it.effect("withholds an in-flight response after leave without advancing a checkpoint", () => {
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const f = fixture({ pauseInbox: { arrived: () => arrived.resolve(), release: release.promise } });
  return Effect.gen(function* () {
    const gateway = yield* Gateway.SymphonyBusGateway;
    yield* admit(a, identityA);
    const pending = yield* Effect.forkChild(
      gateway.call(a, { operation: "inbox" }).pipe(Effect.flip),
    );
    yield* Effect.promise(() => arrived.promise);
    const left = yield* (yield* Participation.ThreadParticipationService).leave({
      ...a,
      expectedGeneration: 1,
      clientRequestId: "leave-during-inbox",
    });
    release.resolve();
    assert.equal((yield* Fiber.join(pending)).code, "revoked");
    assert.equal(left.pendingReason, "native_reconfigure_required");
    assert.equal(
      (yield* (yield* Participation.ThreadParticipationService).status(a)).desiredState,
      "left",
    );
    assert.equal(f.closes(), 1);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "endpoint disable or revision change stays pending without reaching the previous endpoint",
  () => {
    let configuration: SymphonyBusConfiguration | null = null;
    const f = fixture({ configuration: () => configuration });
    return Effect.gen(function* () {
      yield* admit(a, identityA);
      const gateway = yield* Gateway.SymphonyBusGateway;
      assert.equal((yield* gateway.call(a, { operation: "whoami" })).reason, "bus_not_configured");
      configuration = { endpoint: "http://127.0.0.1:9998/replacement" };
      assert.equal((yield* gateway.call(a, { operation: "whoami" })).state, "pending");
      assert.equal(f.calls.length, 0);
    }).pipe(Effect.provide(f.layer));
  },
);

const decodeResult = Schema.decodeUnknownEffect(SymphonyBusResult);
const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "private-gateway-fixture", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "private-gateway-fixture", version: "1" },
  },
  getClient: Effect.die("unused"),
});
it.effect("production MCP registration derives identity from real conversation credentials", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const issuedA = yield* issueCaller(a, identityA);
    const issuedB = yield* issueCaller(b, identityB);
    const server = yield* McpServer.McpServer;
    const call = (scope: McpInvocationContext.McpInvocationScope) =>
      server
        .callTool({ name: "t3_symphony_bus", arguments: { operation: "inbox" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, mcpClient),
        );
    const first = yield* call(issuedA.scope);
    const second = yield* call(issuedB.scope);
    assert.equal(first.isError, false);
    assert.equal(second.isError, false);
    assert.equal((yield* decodeResult(first.structuredContent)).identity, identityA);
    assert.equal((yield* decodeResult(second.structuredContent)).identity, identityB);
    const before = f.calls.length;
    const stale = yield* call({
      ...issuedA.scope,
      thread: { ...issuedA.scope.thread, providerSessionId: issuedB.caller.mcpCredentialId },
    });
    assert.equal(stale.isError, true);
    const external = {
      ...issuedA.scope,
      thread: undefined,
      client: { sessionId: "external", label: "external", access: "full-access" as const },
    };
    assert.equal((yield* call(external)).isError, true);
    assert.equal(f.calls.length, before);
  }).pipe(Effect.provide(registeredFixture(f)));
});

function registeredFixture(
  f: ReturnType<typeof fixture>,
  isLive: () => boolean = () => true,
  activeRunId?: () => string,
) {
  const registry = Layer.effect(
    McpSessionRegistry.McpSessionRegistry,
    McpSessionRegistry.__testing.make(),
  ).pipe(
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      Layer.mock(HttpServer.HttpServer)({
        address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 9997),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(environmentId),
      }),
    ),
  );
  return toolkitRegistration(OrchestratorToolkit, Handlers.layer).pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(NodeCrypto.layer),
    Layer.provideMerge(f.layer),
    Layer.provide(Delivery.layer.pipe(Layer.provide(f.layer), Layer.provide(NodeCrypto.layer))),
    Layer.provideMerge(McpProviderSessions.layer),
    Layer.provideMerge(registry),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed(
            McpToolAccessTestkit.liveThreadShell(
              id,
              isLive()
                ? activeRunId
                  ? { activeRunId: RunId.make(activeRunId()) }
                  : {}
                : { activeRunId: null },
            ),
          ),
      }),
    ),
    Layer.provide(Layer.mock(OrchestratorService.OrchestratorMcpService)({})),
    Layer.provide(Layer.mock(ThreadMetadata.ThreadMetadataMcpService)({})),
    Layer.provide(Layer.mock(Control.ThreadParticipationControl)({})),
  );
}
const issueCaller = Effect.fn("fixture.issueCaller")(function* (
  target: typeof a = a,
  identity = identityA,
  joined = true,
) {
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const credential = yield* registry.issue({
    threadId: target.threadId,
    providerInstanceId: ProviderInstanceId.make("codex"),
  });
  yield* (yield* McpProviderSessions.McpProviderSessions).set(credential.config);
  const scope = yield* registry.resolve(
    credential.config.authorizationHeader.replace(/^Bearer\s+/, ""),
  );
  if (!scope) return yield* Effect.die("Fixture credential failed to resolve");
  const caller = { ...target, mcpCredentialId: credential.config.providerSessionId };
  if (joined) yield* admit(caller, identity);
  return { scope, caller, registry };
});

it.effect("reads native credential identity without joining or contacting the bus", () => {
  const f = fixture({ configuration: () => null });
  return Effect.gen(function* () {
    const issuedA = yield* issueCaller(a, identityA, false);
    const issuedB = yield* issueCaller(b, identityB, false);
    const server = yield* McpServer.McpServer;
    const call = (scope: McpInvocationContext.McpInvocationScope) =>
      server
        .callTool({ name: "t3_symphony_runtime_identity", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          Effect.provideService(McpSchema.McpServerClient, mcpClient),
        );
    for (const issued of [issuedA, issuedB]) {
      const result = yield* call(issued.scope);
      assert.equal(result.isError, false);
      assert.deepEqual(result.structuredContent, {
        environmentId,
        threadId: issued.caller.threadId,
        providerInstanceId: "codex",
        mcpCredentialId: issued.caller.mcpCredentialId,
      });
    }
    assert.notEqual(issuedA.caller.mcpCredentialId, issuedB.caller.mcpCredentialId);
    const session = yield* (yield* McpProviderSessions.McpProviderSessions).read(a.threadId);
    assert.isDefined(session);
    const exposed = JSON.stringify((yield* call(issuedA.scope)).structuredContent);
    assert.notInclude(exposed, session!.authorizationHeader.replace(/^Bearer\s+/, ""));
    assert.equal(
      (yield* call({
        ...issuedA.scope,
        thread: { ...issuedA.scope.thread, providerSessionId: issuedB.caller.mcpCredentialId },
      })).isError,
      true,
    );
    yield* issuedA.registry.revokeProviderSession(issuedA.caller.mcpCredentialId);
    assert.equal((yield* call(issuedA.scope)).isError, true);
    assert.equal(
      (yield* call({
        ...issuedB.scope,
        thread: undefined,
        client: { sessionId: "external", label: "external", access: "full-access" as const },
      })).isError,
      true,
    );
    assert.equal(f.calls.length, 0);
    const sql = yield* SqlClient.SqlClient;
    assert.equal((yield* sql`SELECT 1 FROM symphony_thread_participation`).length, 0);
    assert.equal((yield* sql`SELECT 1 FROM symphony_participation_requests`).length, 0);
  }).pipe(Effect.provide(registeredFixture(f, () => false)));
});
const publishThroughMcp = (scope: McpInvocationContext.McpInvocationScope) =>
  Effect.flatMap(McpServer.McpServer, (server) =>
    server.callTool({
      name: "t3_symphony_bus",
      arguments: {
        operation: "publish",
        publication: {
          type: "note",
          subject: "Fixture",
          body: "Private auth regression.",
          topics: ["graph:github-7"],
          idempotencyKey: "auth-stable-key",
        },
      },
    }),
  ).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, mcpClient),
  );

it.effect(
  "production native hook emits exact hook JSON and requires a current caller-scoped receipt",
  () => {
    const f = fixture();
    let live = true;
    return Effect.gen(function* () {
      const issuedA = yield* issueCaller(a, identityA);
      const issuedB = yield* issueCaller(b, identityB);
      yield* (yield* Gateway.SymphonyBusGateway).call(issuedB.caller, {
        operation: "publish",
        publication: {
          type: "note",
          subject: "Directed fixture",
          body: "Private rendered receipt test.",
          topics: [`agent:${identityA}`],
          deliverTo: [identityA],
          idempotencyKey: "receipt-fixture",
        },
      });
      const server = yield* McpServer.McpServer;
      const call = (
        scope: McpInvocationContext.McpInvocationScope,
        name: string,
        args: Record<string, unknown>,
      ) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, mcpClient),
          );
      const output = yield* call(issuedA.scope, "t3_symphony_hook", {
        event: "UserPromptSubmit",
        sessionId: "hook-coordinator",
        turnId: "native-turn",
      });
      assert.equal(output.isError, false);
      assert.equal(output.content.length, 1);
      assert.equal(output.content[0]?.type, "text");
      const json = JSON.parse(output.content[0]?.type === "text" ? output.content[0].text : "{}");
      assert.deepEqual(json, output.structuredContent);
      assert.equal(json.hookSpecificOutput.hookEventName, "UserPromptSubmit");
      const token = /\{"token":"([^"]+)"\}/.exec(json.hookSpecificOutput.additionalContext)?.[1];
      assert.isDefined(token);
      const sql = yield* SqlClient.SqlClient;
      const cursor = Effect.gen(function* () {
        const [row] = yield* sql<{
          record_json: string;
        }>`SELECT record_json FROM symphony_delivery_state`;
        return JSON.parse(row!.record_json).cursor;
      });
      assert.equal(yield* cursor, 0);
      assert.equal(
        (yield* call(issuedB.scope, "t3_symphony_delivery_receipt", { token })).isError,
        true,
      );
      live = false;
      assert.equal(
        (yield* call(issuedA.scope, "t3_symphony_delivery_receipt", { token })).isError,
        true,
      );
      assert.equal(yield* cursor, 0);
      live = true;
      const before = f.calls.length;
      const received = yield* call(issuedA.scope, "t3_symphony_delivery_receipt", { token });
      assert.equal(received.isError, false);
      assert.deepEqual(received.structuredContent, { state: "received" });
      assert.equal(yield* cursor, 1);
      assert.equal(f.calls.length, before);
      assert.deepEqual(
        (yield* call(issuedA.scope, "t3_symphony_delivery_receipt", { token })).structuredContent,
        { state: "already_received" },
      );
    }).pipe(Effect.provide(registeredFixture(f, () => live)));
  },
);

it.effect(
  "a run replacement revokes an in-flight native display without advancing or storing output",
  () => {
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = fixture({
      pauseInbox: { arrived: () => arrived.resolve(), release: release.promise },
    });
    let run = "first-run";
    return Effect.gen(function* () {
      const issued = yield* issueCaller();
      const server = yield* McpServer.McpServer;
      const request = server
        .callTool({
          name: "t3_symphony_hook",
          arguments: {
            event: "UserPromptSubmit",
            sessionId: "hook-coordinator",
            turnId: "native-turn",
          },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, issued.scope),
          Effect.provideService(McpSchema.McpServerClient, mcpClient),
        );
      const pending = yield* Effect.forkChild(request);
      yield* Effect.promise(() => arrived.promise);
      run = "replacement-run";
      release.resolve();
      assert.equal((yield* Fiber.join(pending)).isError, true);
      const sql = yield* SqlClient.SqlClient;
      assert.equal((yield* sql`SELECT 1 FROM symphony_delivery_batches`).length, 0);
      assert.equal((yield* sql`SELECT 1 FROM symphony_delivery_state`).length, 0);
    }).pipe(
      Effect.provide(
        registeredFixture(
          f,
          () => true,
          () => run,
        ),
      ),
    );
  },
);

// P1-BUS-01: an admitted MCP request must not retain publication rights after revocation or stop.
it.effect("rechecks real credential authority and caller liveness before publishing", () =>
  Effect.gen(function* () {
    for (const revoke of [true, false]) {
      const arrived = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let live = true;
      const f = fixture({
        pauseWho: { arrived: () => arrived.resolve(), release: release.promise },
      });
      yield* Effect.gen(function* () {
        const { scope, caller, registry } = yield* issueCaller();
        const pending = yield* Effect.forkChild(publishThroughMcp(scope));
        yield* Effect.promise(() => arrived.promise);
        if (revoke) yield* registry.revokeProviderSession(caller.mcpCredentialId);
        else live = false;
        release.resolve();
        const result = yield* Fiber.join(pending);
        assert.equal(result.isError, true);
        assert.deepEqual(
          f.calls.map((c) => c.method),
          ["symphony_whoami"],
        );
      }).pipe(Effect.provide(registeredFixture(f, () => live)));
    }
  }),
);

// P2-BUS-02: deliverTo cannot smuggle a new recipient beside an otherwise permitted graph topic.
it.effect("requires an explicit matching topic for every direct recipient", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit(a, identityA);
    const request = {
      operation: "publish" as const,
      publication: {
        type: "note",
        subject: "Fixture",
        body: "Private recipient regression.",
        topics: ["graph:github-7"],
        deliverTo: [identityB],
        idempotencyKey: "direct-stable-key",
      },
    };
    assert.equal(
      (yield* (yield* Gateway.SymphonyBusGateway).call(a, request).pipe(Effect.flip)).code,
      "forbidden",
    );
    assert.equal(f.calls.length, 0);
  }).pipe(Effect.provide(f.layer));
});

// P2-BUS-03: an initialization error may abort the SDK transport after allocating a remote session.
it.effect("cleans an allocated session with fresh authority after failed initialization", () => {
  const f = fixture({ protocolVersion: "1900-01-01" });
  return Effect.gen(function* () {
    yield* admit(a, identityA);
    assert.equal(
      (yield* (yield* Gateway.SymphonyBusGateway)
        .call(a, { operation: "whoami" })
        .pipe(Effect.flip)).code,
      "unavailable",
    );
    assert.equal(f.allocated.size, 0);
    assert.deepEqual(f.cleanup, [
      { aborted: false, identity: identityA, session: `session-${identityA}` },
    ]);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "withholds a completed publication response after revocation and retains its original key",
  () => {
    const arrived = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = fixture({
      pausePublish: { arrived: () => arrived.resolve(), release: release.promise },
    });
    return Effect.gen(function* () {
      const { scope, caller, registry } = yield* issueCaller();
      const pending = yield* Effect.forkChild(publishThroughMcp(scope));
      yield* Effect.promise(() => arrived.promise);
      yield* registry.revokeProviderSession(caller.mcpCredentialId);
      release.resolve();
      assert.equal((yield* Fiber.join(pending)).isError, true);
      const sent = f.calls.filter((c) => c.method === "symphony_publish");
      assert.equal(sent.length, 1);
      assert.equal(sent[0]?.args.idempotency_key, "auth-stable-key");
      assert.equal(f.closes(), 1);
    }).pipe(Effect.provide(registeredFixture(f)));
  },
);

it.effect("preserves the frozen engine's reply token beside the newer reply field", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit(a, identityA);
    yield* (yield* Gateway.SymphonyBusGateway).call(a, {
      operation: "publish",
      publication: {
        type: "note",
        subject: "Reply",
        body: "Private fixture reply.",
        topics: ["graph:github-7"],
        idempotencyKey: "reply-stable-key",
        inReplyTo: 41,
      },
    });
    const publication = f.calls.find((c) => c.method === "symphony_publish")!;
    assert.equal(publication.args.in_reply_to, 41);
    assert.deepEqual(publication.args.refs, { urls: ["symphony:in_reply_to:41"] });
  }).pipe(Effect.provide(f.layer));
});

// Live readonly protocol evidence: this sidecar stalls bounded tool requests behind a persistent GET stream.
it.effect("bounded bus calls do not open a notification GET stream", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit(a, identityA);
    yield* (yield* Gateway.SymphonyBusGateway).call(a, { operation: "whoami" });
    assert.equal(f.networkGets(), 0);
    assert.equal(f.closes(), 1);
  }).pipe(Effect.provide(f.layer));
});
