import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ThreadId,
  ProviderSessionId,
  type SymphonyParticipation,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Participation from "./ThreadParticipationService.ts";

const scope = { environmentId: EnvironmentId.make("fedora"), threadId: ThreadId.make("chief") };
const other = { ...scope, threadId: ThreadId.make("owner") };
const identity = "v12:mario-loomia:orchestrator";
const program = <A, E>(
  body: (
    service: Participation.ThreadParticipationService["Service"],
    sql: SqlClient.SqlClient,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* body(yield* Participation.ThreadParticipationService, yield* SqlClient.SqlClient);
  }).pipe(
    Effect.provide(Participation.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory))),
  );
const binding = (r: SymphonyParticipation) => ({
  nativeThreadId: "native-thread",
  nativeSessionId: "native-hook",
  providerSessionId: ProviderSessionId.make("provider-session"),
  harnessPid: 12345,
  harnessStart: "100",
  pluginGeneration: r.nativeGeneration,
});
const join = (
  service: Participation.ThreadParticipationService["Service"],
  request = "join-1",
  expectedGeneration = 0,
) =>
  service.join({
    ...scope,
    identity,
    topics: ["graph:2606", "agent:loomia-cos"],
    clientRequestId: request,
    expectedGeneration,
  });

it.effect("starts quiet and persists explicit intent across service reconstruction", () =>
  program((service, sql) =>
    Effect.gen(function* () {
      const quiet = yield* service.status(scope);
      assert.equal(quiet.desiredState, "left");
      assert.equal(quiet.desiredGeneration, 0);
      const joined = yield* join(service);
      assert.equal(joined.pendingReason, "native_reconfigure_required");
      assert.equal(joined.appliedGeneration, 0);
      assert.deepEqual(joined.topics, ["agent:loomia-cos", "graph:github-2606"]);
      const restarted = yield* Participation.ThreadParticipationService.pipe(
        Effect.provide(
          Participation.layer.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, sql))),
        ),
      );
      assert.deepEqual(yield* restarted.status(scope), joined);
      assert.equal((yield* restarted.status(other)).desiredState, "left");
    }),
  ),
);

it.effect(
  "replays an old request without undoing a later leave and rejects changed request meaning",
  () =>
    program((service) =>
      Effect.gen(function* () {
        const first = yield* join(service);
        yield* service.leave({ ...scope, clientRequestId: "leave-1", expectedGeneration: 1 });
        const replay = yield* join(service);
        assert.deepEqual(replay, first);
        assert.equal((yield* service.status(scope)).desiredState, "left");
        const conflicting = yield* service
          .join({
            ...scope,
            identity,
            topics: ["broadcast"],
            clientRequestId: "join-1",
            expectedGeneration: 0,
          })
          .pipe(Effect.flip);
        assert.equal(conflicting.code, "conflict");
        const stale = yield* join(service, "delayed-first-join", 0).pipe(Effect.flip);
        assert.equal(stale.code, "conflict");
      }),
    ),
);

it.effect("keeps an effective identity reserved until native leave is acknowledged", () =>
  program((service) =>
    Effect.gen(function* () {
      yield* join(service);
      const reserved = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
      yield* service.applied({
        ...scope,
        expectedGeneration: 1,
        nativeGeneration: reserved.nativeGeneration,
        binding: binding(reserved),
      });
      const left = yield* service.leave({
        ...scope,
        clientRequestId: "leave",
        expectedGeneration: 1,
      });
      assert.equal(left.pendingReason, "native_reconfigure_required");
      const duplicate = yield* service
        .join({ ...other, identity, topics: [], clientRequestId: "reuse", expectedGeneration: 0 })
        .pipe(Effect.flip);
      assert.equal(duplicate.code, "identity_in_use");
      const removing = yield* service.reserveNative({ ...scope, expectedGeneration: 2 });
      yield* service.applied({
        ...scope,
        expectedGeneration: 2,
        nativeGeneration: removing.nativeGeneration,
        binding: null,
      });
      assert.equal(
        (yield* service.join({
          ...other,
          identity,
          topics: [],
          clientRequestId: "reuse",
          expectedGeneration: 0,
        })).desiredState,
        "joined",
      );
    }),
  ),
);

it.effect(
  "fences stale apply and cleanup while preserving desired participation across idle unload",
  () =>
    program((service) =>
      Effect.gen(function* () {
        yield* join(service);
        const old = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
        const unresolved = yield* service
          .reserveNative({ ...scope, expectedGeneration: 1 })
          .pipe(Effect.flip);
        assert.equal(unresolved.code, "conflict");
        yield* service.detached({
          ...scope,
          expectedGeneration: 1,
          nativeGeneration: old.nativeGeneration,
        });
        const next = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
        const stale = yield* service
          .applied({
            ...scope,
            expectedGeneration: 1,
            nativeGeneration: old.nativeGeneration,
            binding: binding(old),
          })
          .pipe(Effect.flip);
        assert.equal(stale.code, "conflict");
        const effective = yield* service.applied({
          ...scope,
          expectedGeneration: 1,
          nativeGeneration: next.nativeGeneration,
          binding: binding(next),
        });
        assert.equal(effective.appliedGeneration, 1);
        const staleCleanup = yield* service
          .detached({ ...scope, expectedGeneration: 1, nativeGeneration: old.nativeGeneration })
          .pipe(Effect.flip);
        assert.equal(staleCleanup.code, "conflict");
        const idle = yield* service.detached({
          ...scope,
          expectedGeneration: 1,
          nativeGeneration: next.nativeGeneration,
        });
        assert.equal(idle.desiredState, "joined");
        assert.equal(idle.pendingReason, "native_not_loaded");
        const resumed = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
        assert.equal(resumed.nativeGeneration, next.nativeGeneration + 1);
      }),
    ),
);

it.effect("retains an unknown leave revision and prevents implicit or invalid joins", () =>
  program((service) =>
    Effect.gen(function* () {
      const left = yield* service.leave({
        ...scope,
        clientRequestId: "cancel-before-join",
        expectedGeneration: 0,
      });
      assert.equal(left.desiredGeneration, 1);
      const stale = yield* join(service).pipe(Effect.flip);
      assert.equal(stale.code, "conflict");
      const invalid = yield* service
        .join({
          ...scope,
          identity,
          topics: ["implicit-cwd"],
          clientRequestId: "invalid-topic",
          expectedGeneration: 1,
        })
        .pipe(Effect.flip);
      assert.equal(invalid.code, "invalid");
      assert.equal((yield* service.status(scope)).desiredState, "left");
    }),
  ),
);

// P1-01: leave cannot free an identity while native attachment is unresolved.
it.effect("retains an unresolved attachment through leave and identity changes", () =>
  program((service) =>
    Effect.gen(function* () {
      yield* join(service);
      const attempt = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
      const replacement = yield* service
        .join({
          ...scope,
          identity: "v12:mario-loomia:reviewer:1",
          topics: [],
          clientRequestId: "change-identity",
          expectedGeneration: 1,
        })
        .pipe(Effect.flip);
      assert.equal(replacement.code, "conflict");
      const left = yield* service.leave({
        ...scope,
        clientRequestId: "leave-during-attach",
        expectedGeneration: 1,
      });
      assert.equal(left.pendingReason, "native_reconfigure_required");
      assert.notEqual(left.appliedGeneration, left.desiredGeneration);
      const stolen = yield* service
        .join({ ...other, identity, topics: [], clientRequestId: "steal", expectedGeneration: 0 })
        .pipe(Effect.flip);
      assert.equal(stolen.code, "identity_in_use");
      yield* service.detached({
        ...scope,
        expectedGeneration: 2,
        nativeGeneration: attempt.nativeGeneration,
      });
      assert.equal(
        (yield* service.join({
          ...other,
          identity,
          topics: [],
          clientRequestId: "steal",
          expectedGeneration: 0,
        })).desiredState,
        "joined",
      );
    }),
  ),
);

// P2-01: a detached operation must never accept its delayed success again.
it.effect("rejects a delayed apply after detach while cleanup stays idempotent", () =>
  program((service) =>
    Effect.gen(function* () {
      yield* join(service);
      const reserved = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
      const acknowledgement = {
        ...scope,
        expectedGeneration: 1,
        nativeGeneration: reserved.nativeGeneration,
        binding: binding(reserved),
      };
      yield* service.applied(acknowledgement);
      const cleanup = {
        ...scope,
        expectedGeneration: 1,
        nativeGeneration: reserved.nativeGeneration,
      };
      const detached = yield* service.detached(cleanup);
      const late = yield* service.applied(acknowledgement).pipe(Effect.flip);
      assert.equal(late.code, "conflict");
      assert.deepEqual(yield* service.detached(cleanup), detached);
      assert.equal((yield* service.status(scope)).nativeBinding, null);
    }),
  ),
);

// P2-02: internal callers also cross runtime validation boundaries.
it.effect("rejects missing and invalid generation tokens before native mutation", () =>
  program((service) =>
    Effect.gen(function* () {
      yield* join(service);
      const reserved = yield* service.reserveNative({ ...scope, expectedGeneration: 1 });
      yield* service.applied({
        ...scope,
        expectedGeneration: 1,
        nativeGeneration: reserved.nativeGeneration,
        binding: binding(reserved),
      });
      for (const generation of [undefined, -1, NaN, 0.5]) {
        const malformed = {
          ...scope,
          expectedGeneration: generation,
          nativeGeneration: reserved.nativeGeneration,
        };
        // Deliberately malformed runtime input exercises the service boundary.
        const error = yield* service
          .detached(malformed as Parameters<typeof service.detached>[0])
          .pipe(Effect.flip);
        assert.equal(error.code, "invalid");
        assert.notEqual((yield* service.status(scope)).nativeBinding, null);
      }
    }),
  ),
);
