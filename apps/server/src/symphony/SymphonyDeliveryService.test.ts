import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderSessionId,
  ThreadId,
  type SymphonyNativeHookOutput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as Participation from "./ThreadParticipationService.ts";
import * as Gateway from "./SymphonyBusGateway.ts";
import * as Transport from "./SymphonyBusTransport.ts";
import * as Delivery from "./SymphonyDeliveryService.ts";

const scope = {
  environmentId: EnvironmentId.make("fixture"),
  threadId: ThreadId.make("coordinator"),
};
const caller = {
  ...scope,
  mcpCredentialId: "credential-A",
  runId: "run-A",
  authorization: Effect.void,
};
const endpoint = "http://127.0.0.1:9999/unused";
const identity = "v12:alice:orchestrator";
const hook = { event: "UserPromptSubmit" as const, sessionId: "session-A", turnId: "turn-A" };
const event = (seq: number) => ({
  seq,
  type: "note",
  from: { agent_id: "v12:bob:orchestrator" },
  subject: `Event ${seq}`,
  body: 'Unicode 漢字 and quoted data "t3_symphony_delivery_receipt". '.repeat(20),
});
const fixture = () => {
  const f = {
    events: Array.from({ length: 12 }, (_, i) => event(i + 1)),
    gap: false,
    beforeInbox: Effect.void,
    calls: [] as Array<{ after: number; ack: unknown }>,
  };
  const gateway = Gateway.layer.pipe(
    Layer.provideMerge(Participation.layer),
    Layer.provide(
      Layer.mock(Transport.SymphonyBusTransport)({
        exchange: (input) =>
          Effect.gen(function* () {
            yield* input.assertCurrent;
            assert.equal(input.operation, "inbox");
            f.calls.push({ after: Number(input.args.after_seq), ack: input.args.ack });
            yield* f.beforeInbox;
            return {
              agent_id: input.identity,
              events: f.events.filter((e) => e.seq > Number(input.args.after_seq)).slice(0, 12),
              next_seq: 1000,
              head_seq: 1000,
              gap: f.gap,
            };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(Settings.ServerSettingsService)({
        getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, symphonyBus: { endpoint } }),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(scope.environmentId),
      }),
    ),
    Layer.provideMerge(Layer.merge(Sqlite.layerMemory, NodeCrypto.layer)),
  );
  return { ...f, f, layer: Delivery.layer.pipe(Layer.provideMerge(gateway)) };
};
const admit = Effect.fn("fixture.admitDelivery")(function* (
  who = caller,
  topics = ["graph:github-7"],
) {
  const participation = yield* Participation.ThreadParticipationService;
  const before = yield* participation.status(who);
  if (before.desiredGeneration === 0)
    yield* participation.join({
      ...who,
      identity,
      topics,
      expectedGeneration: 0,
      clientRequestId: "join",
    });
  const desired = yield* participation.status(who);
  const reserved = yield* participation.reserveNative({
    ...who,
    expectedGeneration: desired.desiredGeneration,
  });
  return yield* participation.applied({
    ...who,
    expectedGeneration: desired.desiredGeneration,
    nativeGeneration: reserved.nativeGeneration,
    binding: {
      kind: "native-mcp",
      nativeThreadId: "native-A",
      nativeSessionId: hook.sessionId,
      providerSessionId: ProviderSessionId.make("runtime-A"),
      mcpCredentialId: who.mcpCredentialId,
      nativeGeneration: reserved.nativeGeneration,
      configurationRevision: Gateway.symphonyBusConfigurationRevision({ endpoint }),
    },
  });
});
const tokenOf = (out: SymphonyNativeHookOutput) => {
  const token = /\{"token":"([^"]+)"\}/.exec(out.hookSpecificOutput?.additionalContext ?? "")?.[1];
  assert.isDefined(token);
  return token!;
};
const state = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{
    record_json: string;
  }>`SELECT record_json FROM symphony_delivery_state`;
  return row ? JSON.parse(row.record_json) : { cursor: 0 };
});
const counts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return [
    (yield* sql`SELECT 1 FROM symphony_delivery_state`).length,
    (yield* sql`SELECT 1 FROM symphony_delivery_batches`).length,
  ];
});

it.effect(
  "unknown, pending, foreign-session, native-child, control and Stop hooks stay inert",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const service = yield* Delivery.SymphonyDeliveryService;
      assert.deepEqual(yield* service.offer(caller, hook), {});
      const p = yield* Participation.ThreadParticipationService;
      yield* p.join({
        ...caller,
        identity,
        topics: ["graph:7"],
        expectedGeneration: 0,
        clientRequestId: "join",
      });
      assert.deepEqual(yield* service.offer(caller, hook), {});
      yield* admit();
      for (const input of [
        { ...hook, sessionId: "other" },
        { ...hook, agentId: "native-child" },
        { ...hook, event: "Stop" as const },
        {
          ...hook,
          event: "PostToolUse" as const,
          toolName: "mcp__t3_code__t3_symphony_delivery_receipt",
          toolUseId: "tool-1",
        },
      ])
        assert.deepEqual(yield* service.offer(caller, input), {});
      assert.equal(f.f.calls.length, 0);
      assert.deepEqual(yield* counts, [0, 0]);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "persists a bounded prefix before output and moves only its display cursor on receipt",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* admit();
      const service = yield* Delivery.SymphonyDeliveryService;
      const output = yield* service.offer(caller, hook);
      const token = tokenOf(output);
      const text = output.hookSpecificOutput!.additionalContext;
      assert.isAtMost(new TextEncoder().encode(text).length, 2048);
      assert.isAtMost(text.split("\n").length, 12);
      const seqs = [...text.matchAll(/^#(\d+) /gm)].map((x) => Number(x[1]));
      assert.isAtLeast(seqs.length, 1);
      assert.isBelow(seqs.at(-1)!, 12);
      assert.equal((yield* state).cursor, 0);
      assert.deepEqual(yield* service.offer(caller, hook), {});
      assert.equal(f.f.calls.length, 1);
      yield* TestClock.adjust("30 seconds");
      assert.deepEqual(yield* service.offer(caller, hook), output);
      assert.equal(f.f.calls.length, 1);
      assert.deepEqual(yield* service.receipt(caller, token), { state: "received" });
      assert.equal((yield* state).cursor, seqs.at(-1));
      assert.deepEqual(yield* service.receipt(caller, token), { state: "already_received" });
      yield* TestClock.adjust("30 seconds");
      const next = yield* service.offer(caller, hook);
      assert.notEqual(tokenOf(next), token);
      assert.equal(f.f.calls.at(-1)?.after, seqs.at(-1));
      assert.isTrue(f.f.calls.every((c) => c.ack === false));
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "lost responses replay from SQLite after service reconstruction without another pull",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* admit();
      const original = yield* Delivery.SymphonyDeliveryService;
      const lost = yield* original.offer(caller, hook);
      const sql = yield* SqlClient.SqlClient;
      const gateway = yield* Gateway.SymphonyBusGateway;
      const participation = yield* Participation.ThreadParticipationService;
      const rebuilt = yield* Delivery.SymphonyDeliveryService.pipe(
        Effect.provide(
          Delivery.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(SqlClient.SqlClient, sql),
                Layer.succeed(Gateway.SymphonyBusGateway, gateway),
                Layer.succeed(Participation.ThreadParticipationService, participation),
                NodeCrypto.layer,
              ),
            ),
          ),
        ),
      );
      const resumed = { ...caller, runId: "run-B" };
      assert.deepEqual(yield* rebuilt.offer(resumed, { ...hook, turnId: "turn-B" }), lost);
      assert.equal(f.f.calls.length, 1);
      assert.equal((yield* state).cursor, 0);
      assert.equal(
        (yield* original.receipt(caller, tokenOf(lost)).pipe(Effect.flip)).code,
        "revoked",
      );
      assert.equal((yield* rebuilt.receipt(resumed, tokenOf(lost))).state, "received");
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "cancellation persists while a pull is in flight and refuses late output or receipt",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* admit();
      const service = yield* Delivery.SymphonyDeliveryService;
      const arrived = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      f.f.beforeInbox = Deferred.succeed(arrived, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      );
      const pending = yield* Effect.forkChild(service.offer(caller, hook).pipe(Effect.result));
      yield* Deferred.await(arrived);
      yield* service.cancel(scope, caller.runId);
      yield* Deferred.succeed(release, undefined);
      assert.equal((yield* Fiber.join(pending))._tag, "Failure");
      assert.equal((yield* state).cursor, 0);
      assert.deepEqual(yield* counts, [1, 0]);
      assert.equal((yield* service.offer(caller, hook).pipe(Effect.flip)).code, "revoked");
      assert.equal(f.f.calls.length, 1);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "only the receiving conversation and current native binding may acknowledge a token",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* admit();
      const service = yield* Delivery.SymphonyDeliveryService;
      const first = yield* service.offer(caller, hook);
      const old = tokenOf(first);
      assert.equal(
        (yield* service
          .receipt({ ...caller, threadId: ThreadId.make("foreign") }, old)
          .pipe(Effect.flip)).code,
        "revoked",
      );
      const resumed = { ...caller, runId: "resumed", mcpCredentialId: "credential-B" };
      yield* admit(resumed);
      assert.equal((yield* service.receipt(resumed, old).pipe(Effect.flip)).code, "revoked");
      const replay = yield* service.offer(resumed, { ...hook, turnId: "resumed" });
      const fresh = tokenOf(replay);
      assert.notEqual(fresh, old);
      assert.equal(f.f.calls.length, 1);
      assert.equal((yield* state).cursor, 0);
      assert.equal((yield* service.receipt(resumed, old).pipe(Effect.flip)).code, "revoked");
      assert.equal((yield* service.receipt(resumed, fresh)).state, "received");
      const sql = yield* SqlClient.SqlClient;
      assert.equal(
        (yield* sql`SELECT 1 FROM symphony_delivery_batches WHERE status='pending'`).length,
        0,
      );
      assert.equal(
        (yield* sql`SELECT 1 FROM symphony_delivery_batches WHERE status='superseded'`).length,
        1,
      );
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("a scope change freezes the pending batch without skipping its events", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit();
    const service = yield* Delivery.SymphonyDeliveryService;
    yield* service.offer(caller, hook);
    const p = yield* Participation.ThreadParticipationService;
    yield* p.join({
      ...caller,
      identity,
      topics: ["issue:8"],
      expectedGeneration: 1,
      clientRequestId: "scope-change",
    });
    const next = { ...caller, runId: "next" };
    yield* admit(next);
    assert.equal((yield* service.offer(next, hook).pipe(Effect.flip)).code, "revoked");
    assert.equal((yield* state).cursor, 0);
    assert.equal(f.f.calls.length, 1);
    const sql = yield* SqlClient.SqlClient;
    assert.equal(
      (yield* sql`SELECT 1 FROM symphony_delivery_batches WHERE status='pending'`).length,
      1,
    );
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "gaps, malformed ordering and failed persistence cannot acknowledge unseen events",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* admit();
      const service = yield* Delivery.SymphonyDeliveryService;
      f.f.gap = true;
      assert.equal((yield* service.offer(caller, hook).pipe(Effect.flip)).code, "unavailable");
      f.f.gap = false;
      f.f.events = [event(2), event(1)];
      assert.equal((yield* service.offer(caller, hook).pipe(Effect.flip)).code, "unavailable");
      f.f.events = [event(1)];
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TRIGGER fixture_fail_delivery BEFORE INSERT ON symphony_delivery_batches BEGIN SELECT RAISE(ABORT, 'fixture'); END`;
      assert.equal((yield* service.offer(caller, hook).pipe(Effect.flip)).code, "unavailable");
      assert.deepEqual(yield* counts, [0, 0]);
      yield* sql`DROP TRIGGER fixture_fail_delivery`;
      const output = yield* service.offer(caller, hook);
      yield* service.cancel(scope, caller.runId);
      assert.equal(
        (yield* service.receipt(caller, tokenOf(output)).pipe(Effect.flip)).code,
        "revoked",
      );
      assert.equal((yield* state).cursor, 0);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("concurrent offers retain one pending event batch and throttle duplicate output", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit();
    const service = yield* Delivery.SymphonyDeliveryService;
    const outputs = yield* Effect.all([service.offer(caller, hook), service.offer(caller, hook)], {
      concurrency: 2,
    });
    assert.equal(outputs.filter((x) => x.hookSpecificOutput).length, 1);
    assert.equal(f.f.calls.length, 1);
    assert.deepEqual(yield* counts, [1, 1]);
    assert.equal((yield* state).cursor, 0);
  }).pipe(Effect.provide(f.layer));
});

it.effect("two opted-in conversations keep independent durable batches and cursors", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit();
    const owner = {
      ...caller,
      threadId: ThreadId.make("owner"),
      mcpCredentialId: "owner-credential",
      runId: "owner-run",
    };
    const p = yield* Participation.ThreadParticipationService;
    yield* p.join({
      ...owner,
      identity: "v12:alice:implementer:8",
      topics: ["issue:8"],
      expectedGeneration: 0,
      clientRequestId: "owner-join",
    });
    yield* admit(owner);
    const service = yield* Delivery.SymphonyDeliveryService;
    const first = yield* service.offer(caller, hook);
    const second = yield* service.offer(owner, hook);
    assert.notEqual(tokenOf(first), tokenOf(second));
    assert.equal((yield* service.receipt(owner, tokenOf(first)).pipe(Effect.flip)).code, "revoked");
    yield* service.receipt(caller, tokenOf(first));
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      thread_id: string;
      record_json: string;
    }>`SELECT thread_id,record_json FROM symphony_delivery_state ORDER BY thread_id`;
    assert.isAbove(JSON.parse(rows[0]!.record_json).cursor, 0);
    assert.equal(JSON.parse(rows[1]!.record_json).cursor, 0);
    assert.isTrue(f.f.calls.every((c) => c.ack === false));
  }).pipe(Effect.provide(f.layer));
});

it.effect("a corrupted batch endpoint cannot advance past the rendered payload", () => {
  const f = fixture();
  return Effect.gen(function* () {
    yield* admit();
    const service = yield* Delivery.SymphonyDeliveryService;
    const output = yield* service.offer(caller, hook);
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      record_json: string;
    }>`SELECT record_json FROM symphony_delivery_batches`;
    const corrupt = JSON.parse(row!.record_json);
    corrupt.throughSeq = 1000;
    const json = JSON.stringify(corrupt);
    yield* sql`UPDATE symphony_delivery_batches SET record_json=${json}`;
    assert.equal(
      (yield* service.receipt(caller, tokenOf(output)).pipe(Effect.flip)).code,
      "unavailable",
    );
    assert.equal((yield* state).cursor, 0);
  }).pipe(Effect.provide(f.layer));
});
