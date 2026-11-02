import {
  SymphonyParticipation,
  SymphonyParticipantIdentity,
  type SymphonyParticipationScope,
  type SymphonyParticipationJoinInput,
  type SymphonyParticipationLeaveInput,
  SymphonyNativeBinding,
  SymphonyParticipationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

interface GenerationInput extends SymphonyParticipationScope {
  readonly expectedGeneration: number;
}
interface NativeGenerationInput extends GenerationInput {
  readonly nativeGeneration: number;
}
export class ThreadParticipationService extends Context.Service<
  ThreadParticipationService,
  {
    readonly status: (
      input: SymphonyParticipationScope,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly join: (
      input: SymphonyParticipationJoinInput,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly leave: (
      input: SymphonyParticipationLeaveInput,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly reserveNative: (
      input: GenerationInput,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly applied: (
      input: NativeGenerationInput & { readonly binding: SymphonyNativeBinding | null },
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly detached: (
      input: NativeGenerationInput,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
  }
>()("t3/symphony/ThreadParticipationService") {}

const failure = (code: SymphonyParticipationError["code"], message: string) =>
  new SymphonyParticipationError({ code, message });
const isParticipationError = Schema.is(SymphonyParticipationError);
const isNativeBinding = Schema.is(Schema.NullOr(SymphonyNativeBinding));
const persistenceError = (cause: unknown) =>
  isParticipationError(cause)
    ? cause
    : new SymphonyParticipationError({
        code: "persistence_error",
        message: "Could not persist conversation participation.",
        cause,
      });
const RecordJson = Schema.fromJsonString(SymphonyParticipation);
const decodeRecord = Schema.decodeUnknownEffect(RecordJson);
const encodeRecord = Schema.encodeEffect(RecordJson);
const decodeIdentity = Schema.decodeUnknownEffect(SymphonyParticipantIdentity);
const Request = Schema.Struct({
  operation: Schema.Literals(["join", "leave"]),
  identity: Schema.optional(Schema.String),
  topics: Schema.optional(Schema.Array(Schema.String)),
  expectedGeneration: Schema.Number,
});
const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(Request));
const encodeBinding = Schema.encodeEffect(
  Schema.fromJsonString(Schema.NullOr(SymphonyNativeBinding)),
);

function normalizeTopics(topics: ReadonlyArray<string>): Array<string> {
  if (topics.length > 64) throw failure("invalid", "At most 64 explicit topics are supported.");
  return [
    ...new Set(
      topics.map((value) => {
        const topic = value.trim();
        if (/^(agents|broadcast|symphony)$/.test(topic)) return topic;
        const issue = /^(issue|graph):(?:github[-:]|#)?(\d{1,9})$/.exec(topic);
        if (issue) return `${issue[1]}:github-${Number(issue[2])}`;
        if (/^(agent|repo|branch):[^\x00-\x20]{1,256}$/.test(topic)) return topic;
        throw failure(
          "invalid",
          "Use explicit bus topics such as issue:2751, graph:2606 or agent:loomia-cos.",
        );
      }),
    ),
  ].sort();
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const empty = (input: SymphonyParticipationScope, at: string): SymphonyParticipation => ({
    environmentId: input.environmentId,
    threadId: input.threadId,
    identity: null,
    principal: null,
    role: null,
    topics: [],
    appliedTopics: [],
    desiredState: "left",
    desiredGeneration: 0,
    appliedGeneration: 0,
    nativeGeneration: 0,
    nativeState: "detached",
    nativeBinding: null,
    pendingReason: null,
    updatedAt: at,
  });
  const read = Effect.fn("ThreadParticipationService.read")(function* (
    input: SymphonyParticipationScope,
  ) {
    const [row] = yield* sql<{
      record_json: string;
    }>`SELECT record_json FROM symphony_thread_participation
      WHERE environment_id = ${input.environmentId} AND thread_id = ${input.threadId}`;
    return row ? yield* decodeRecord(row.record_json) : empty(input, yield* now);
  });
  const write = Effect.fn("ThreadParticipationService.write")(function* (
    record: SymphonyParticipation,
  ) {
    const json = yield* encodeRecord(record);
    const holds = record.desiredState === "joined" || record.nativeState !== "detached";
    if (holds && record.identity !== null) {
      const others = yield* sql`SELECT 1 FROM symphony_thread_participation
        WHERE environment_id = ${record.environmentId} AND identity = ${record.identity}
          AND holds_identity = 1 AND thread_id <> ${record.threadId}`;
      if (others.length)
        return yield* failure(
          "identity_in_use",
          "This identity is still owned by another conversation.",
        );
    }
    yield* sql`INSERT INTO symphony_thread_participation (environment_id, thread_id, identity, holds_identity, record_json)
      VALUES (${record.environmentId}, ${record.threadId}, ${record.identity}, ${holds ? 1 : 0}, ${json})
      ON CONFLICT(environment_id, thread_id) DO UPDATE SET identity = excluded.identity, holds_identity = excluded.holds_identity, record_json = excluded.record_json`;
    return record;
  });
  const checkGeneration = (record: SymphonyParticipation, expected: number) =>
    !Number.isSafeInteger(expected) || expected < 0
      ? Effect.fail(failure("invalid", "A nonnegative integer generation is required."))
      : record.desiredGeneration === expected
        ? Effect.void
        : Effect.fail(
            failure("conflict", "Participation changed; refresh its generation before retrying."),
          );
  const checkNativeGeneration = (current: SymphonyParticipation, generation: number) =>
    !Number.isSafeInteger(generation) || generation < 1
      ? Effect.fail(failure("invalid", "A positive integer native generation is required."))
      : current.nativeGeneration === generation
        ? Effect.void
        : Effect.fail(
            failure("conflict", "A newer native lifecycle operation owns participation."),
          );
  const mutation = Effect.fn("ThreadParticipationService.mutate")(
    function* (
      input: SymphonyParticipationScope & { readonly clientRequestId: string },
      request: typeof Request.Type,
      update: (
        current: SymphonyParticipation,
      ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>,
    ) {
      if (!input.clientRequestId || input.clientRequestId.length > 256)
        return yield* failure(
          "invalid",
          "A stable request ID of at most 256 characters is required.",
        );
      const requestJson = yield* encodeRequest(request);
      const [receipt] = yield* sql<{
        request_json: string;
        response_json: string;
      }>`SELECT request_json, response_json FROM symphony_participation_requests
      WHERE environment_id = ${input.environmentId} AND thread_id = ${input.threadId} AND client_request_id = ${input.clientRequestId}`;
      if (receipt) {
        if (receipt.request_json !== requestJson)
          return yield* failure(
            "conflict",
            "That request ID was already used for different participation changes.",
          );
        return yield* decodeRecord(receipt.response_json);
      }
      const record = yield* update(yield* read(input));
      yield* write(record);
      yield* sql`INSERT INTO symphony_participation_requests (environment_id, thread_id, client_request_id, request_json, response_json)
      VALUES (${input.environmentId}, ${input.threadId}, ${input.clientRequestId}, ${requestJson}, ${yield* encodeRecord(record)})`;
      return record;
    },
    (effect) => sql.withTransaction(effect).pipe(Effect.mapError(persistenceError)),
  );

  const status = Effect.fn("ThreadParticipationService.status")(
    (input: SymphonyParticipationScope) => read(input).pipe(Effect.mapError(persistenceError)),
  );
  const join = Effect.fn("ThreadParticipationService.join")(function* (
    input: SymphonyParticipationJoinInput,
  ) {
    const identity = yield* decodeIdentity(input.identity).pipe(
      Effect.mapError(() => failure("invalid", "Use an explicit v12 participant identity.")),
    );
    const topics = yield* Effect.try({
      try: () => normalizeTopics(input.topics),
      catch: persistenceError,
    });
    return yield* mutation(
      input,
      { operation: "join", identity, topics, expectedGeneration: input.expectedGeneration },
      (current) =>
        Effect.gen(function* () {
          yield* checkGeneration(current, input.expectedGeneration);
          if (current.nativeState !== "detached" && current.identity !== identity)
            return yield* failure(
              "conflict",
              "Leave and verify native detachment before changing this conversation's identity.",
            );
          if (
            current.desiredState === "joined" &&
            current.identity === identity &&
            current.topics.length === topics.length &&
            current.topics.every((topic, index) => topic === topics[index])
          )
            return current;
          const [, principal, role] = identity.split(":");
          return {
            ...current,
            identity,
            principal: principal!,
            role: role as NonNullable<SymphonyParticipation["role"]>,
            topics,
            desiredState: "joined" as const,
            desiredGeneration: current.desiredGeneration + 1,
            pendingReason: "native_reconfigure_required" as const,
            updatedAt: yield* now,
          };
        }),
    );
  });
  const leave = Effect.fn("ThreadParticipationService.leave")(
    (input: SymphonyParticipationLeaveInput) =>
      mutation(
        input,
        { operation: "leave", expectedGeneration: input.expectedGeneration },
        (current) =>
          Effect.gen(function* () {
            yield* checkGeneration(current, input.expectedGeneration);
            const generation = current.desiredGeneration + 1;
            return {
              ...current,
              desiredState: "left" as const,
              desiredGeneration: generation,
              appliedGeneration:
                current.nativeState === "detached" ? generation : current.appliedGeneration,
              pendingReason:
                current.nativeState === "detached"
                  ? null
                  : ("native_reconfigure_required" as const),
              updatedAt: yield* now,
            };
          }),
      ),
  );
  const reserveNative = Effect.fn("ThreadParticipationService.reserveNative")(
    function* (input: GenerationInput) {
      const current = yield* read(input);
      yield* checkGeneration(current, input.expectedGeneration);
      if (
        current.desiredGeneration === 0 ||
        (current.desiredState === "left" && current.nativeState === "detached")
      )
        return yield* failure(
          "conflict",
          "The conversation has no native participation to change.",
        );
      if (current.nativeState === "reserved")
        return yield* failure(
          "conflict",
          "Reconcile the unresolved native operation before reserving another.",
        );
      return yield* write({
        ...current,
        nativeState: "reserved",
        appliedGeneration: current.desiredState === "joined" ? 0 : current.appliedGeneration,
        nativeGeneration: current.nativeGeneration + 1,
        pendingReason: "native_reconfigure_required",
        updatedAt: yield* now,
      });
    },
    (effect) => sql.withTransaction(effect).pipe(Effect.mapError(persistenceError)),
  );
  const applied = Effect.fn("ThreadParticipationService.applied")(
    function* (input: NativeGenerationInput & { readonly binding: SymphonyNativeBinding | null }) {
      const current = yield* read(input);
      yield* checkGeneration(current, input.expectedGeneration);
      yield* checkNativeGeneration(current, input.nativeGeneration);
      if (current.nativeState === "detached")
        return yield* failure(
          "conflict",
          "This native operation was detached; reserve a new operation before applying.",
        );
      if (!isNativeBinding(input.binding))
        return yield* failure("invalid", "A complete native acknowledgement is required.");
      if ((current.desiredState === "joined") !== (input.binding !== null))
        return yield* failure(
          "conflict",
          "Native binding does not match the desired participation state.",
        );
      if (
        input.binding &&
        (input.binding.pluginGeneration !== input.nativeGeneration || input.binding.harnessPid <= 1)
      )
        return yield* failure(
          "invalid",
          "Native acknowledgement must match this reserved generation and a live harness identity.",
        );
      if (current.appliedGeneration === current.desiredGeneration) {
        if ((yield* encodeBinding(current.nativeBinding)) !== (yield* encodeBinding(input.binding)))
          return yield* failure(
            "conflict",
            "This generation already has another applied native mapping.",
          );
        return current;
      }
      return yield* write({
        ...current,
        nativeState: input.binding === null ? "detached" : "applied",
        nativeBinding: input.binding,
        appliedGeneration: current.desiredGeneration,
        appliedTopics: current.desiredState === "joined" ? current.topics : [],
        pendingReason: null,
        updatedAt: yield* now,
      });
    },
    (effect) => sql.withTransaction(effect).pipe(Effect.mapError(persistenceError)),
  );
  const detached = Effect.fn("ThreadParticipationService.detached")(
    function* (input: NativeGenerationInput) {
      const current = yield* read(input);
      yield* checkGeneration(current, input.expectedGeneration);
      yield* checkNativeGeneration(current, input.nativeGeneration);
      if (current.nativeState === "detached") return current;
      return yield* write({
        ...current,
        nativeState: "detached",
        nativeBinding: null,
        appliedTopics: [],
        appliedGeneration: current.desiredState === "left" ? current.desiredGeneration : 0,
        pendingReason: current.desiredState === "left" ? null : "native_not_loaded",
        updatedAt: yield* now,
      });
    },
    (effect) => sql.withTransaction(effect).pipe(Effect.mapError(persistenceError)),
  );
  return ThreadParticipationService.of({ status, join, leave, reserveNative, applied, detached });
});
export const layer = Layer.effect(ThreadParticipationService, make);
