import {
  CommandId,
  SidebarSectionError,
  type SidebarClient,
  type SidebarTarget,
  type SidebarSectionsSnapshot,
  type SidebarAssignInput,
  type SidebarSectionEvent,
  type SidebarSectionRequest,
  type SidebarSectionResponse,
  type SidebarClientRegistration,
  type AuthSessionId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

type AssignmentResult = SidebarSectionsSnapshot & {
  readonly threadId: SidebarAssignInput["threadId"];
  readonly sectionId: string | null;
  readonly verified: true;
};
export class SidebarSections extends Context.Service<
  SidebarSections,
  {
    readonly connect: (
      sessionId: AuthSessionId,
      registration: SidebarClientRegistration,
    ) => Effect.Effect<Stream.Stream<SidebarSectionEvent>, SidebarSectionError, Scope.Scope>;
    readonly respond: (
      sessionId: AuthSessionId,
      response: SidebarSectionResponse,
    ) => Effect.Effect<void, SidebarSectionError>;
    readonly clients: Effect.Effect<ReadonlyArray<SidebarClient>>;
    readonly list: (
      target: SidebarTarget,
    ) => Effect.Effect<SidebarSectionsSnapshot, SidebarSectionError>;
    readonly assign: (
      input: SidebarAssignInput,
    ) => Effect.Effect<AssignmentResult, SidebarSectionError>;
  }
>()("t3/sidebar/SidebarSections") {}

interface Connection {
  readonly identity: SidebarClient;
  readonly sessionId: AuthSessionId;
  readonly queue: Queue.Queue<SidebarSectionEvent>;
}
interface Pending {
  readonly connection: Connection;
  readonly mutation: boolean;
  readonly result: Deferred.Deferred<SidebarSectionsSnapshot, SidebarSectionError>;
}
const make = Effect.gen(function* () {
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironmentIdentity)
    .getEnvironmentId;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const connections = new Map<string, Connection>();
  const pending = new Map<string, Pending>();
  const checkEnvironment = (id: SidebarTarget["environmentId"]) =>
    id === environmentId
      ? Effect.void
      : Effect.fail(
          new SidebarSectionError({ reason: "wrong_environment", outcomeUnknown: false }),
        );
  const resolve = Effect.fn("SidebarSections.resolve")(function* (target: SidebarTarget) {
    yield* checkEnvironment(target.environmentId);
    const matches = [...connections.values()].filter(
      ({ identity }) =>
        identity.clientId === target.clientId &&
        (target.connectionId === undefined || identity.connectionId === target.connectionId),
    );
    if (matches.length !== 1)
      return yield* new SidebarSectionError({
        reason: matches.length === 0 ? "client_unavailable" : "client_ambiguous",
        outcomeUnknown: false,
      });
    return matches[0]!;
  });
  const invoke = Effect.fn("SidebarSections.invoke")(function* (
    target: SidebarTarget,
    operation:
      | { readonly type: "list" }
      | Omit<Extract<SidebarSectionRequest, { type: "assign" }>, "requestId">,
  ) {
    const connection = yield* resolve(target);
    const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    const result = yield* Deferred.make<SidebarSectionsSnapshot, SidebarSectionError>();
    pending.set(requestId, { connection, mutation: operation.type === "assign", result });
    yield* Queue.offer(connection.queue, {
      ...connection.identity,
      request: { ...operation, requestId },
    });
    return yield* Deferred.await(result).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () =>
          Effect.fail(
            new SidebarSectionError({
              reason: "timeout",
              outcomeUnknown: operation.type === "assign",
            }),
          ),
      }),
      Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
    );
  });
  const list = Effect.fn("SidebarSections.list")(function* (target: SidebarTarget) {
    return yield* invoke(target, { type: "list" });
  });
  const connect = Effect.fn("SidebarSections.connect")(function* (
    sessionId: AuthSessionId,
    registration: SidebarClientRegistration,
  ) {
    yield* checkEnvironment(registration.environmentId);
    const connectionId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    const queue = yield* Queue.unbounded<SidebarSectionEvent>();
    const connection = { identity: { ...registration, connectionId }, sessionId, queue };
    yield* Effect.acquireRelease(
      Effect.sync(() => connections.set(connectionId, connection)),
      () =>
        Effect.gen(function* () {
          connections.delete(connectionId);
          for (const [id, request] of pending) {
            if (request.connection !== connection) continue;
            pending.delete(id);
            yield* Deferred.fail(
              request.result,
              new SidebarSectionError({
                reason: "client_disconnected",
                outcomeUnknown: request.mutation,
              }),
            );
          }
          yield* Queue.shutdown(queue);
        }),
    );
    return Stream.fromQueue(queue);
  });
  const respond = Effect.fn("SidebarSections.respond")(function* (
    sessionId: AuthSessionId,
    response: SidebarSectionResponse,
  ) {
    const request = pending.get(response.requestId);
    if (
      request === undefined ||
      request.connection.sessionId !== sessionId ||
      request.connection.identity.connectionId !== response.connectionId ||
      request.connection.identity.clientId !== response.clientId ||
      response.environmentId !== environmentId
    ) {
      return yield* new SidebarSectionError({ reason: "invalid_response", outcomeUnknown: false });
    }
    if (!response.result.ok) {
      yield* Deferred.fail(request.result, response.result.error);
    } else {
      const snapshot = response.result.snapshot;
      const identity = request.connection.identity;
      if (
        snapshot.environmentId !== environmentId ||
        snapshot.clientId !== identity.clientId ||
        snapshot.connectionId !== identity.connectionId ||
        snapshot.surface !== identity.surface ||
        new Set(snapshot.sections.map((section) => section.id)).size !== snapshot.sections.length
      ) {
        yield* Deferred.fail(
          request.result,
          new SidebarSectionError({ reason: "invalid_response", outcomeUnknown: request.mutation }),
        );
      } else yield* Deferred.succeed(request.result, snapshot);
    }
  });
  const assign = Effect.fn("SidebarSections.assign")(function* (input: SidebarAssignInput) {
    const before = yield* list(input);
    // Freeze the connection: reconnecting during a mutation must never silently retarget it.
    const target = { ...input, connectionId: before.connectionId };
    if (
      input.sectionId !== null &&
      !before.sections.some((section) => section.id === input.sectionId)
    )
      return yield* new SidebarSectionError({ reason: "section_not_found", outcomeUnknown: false });
    const memberships = before.sections.filter((section) =>
      section.threadIds.includes(input.threadId),
    );
    const previous = memberships[0]?.id ?? null;
    if (
      memberships.length > 1 ||
      (previous !== null && previous !== input.sectionId && input.mode !== "move")
    )
      return yield* new SidebarSectionError({
        reason: "membership_conflict",
        outcomeUnknown: false,
      });
    const thread = yield* threads
      .getThreadShell(input.threadId)
      .pipe(
        Effect.mapError(
          () => new SidebarSectionError({ reason: "thread_unavailable", outcomeUnknown: false }),
        ),
      );
    if (
      thread === null ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.snoozedUntil !== null ||
      thread.settledOverride === "settled"
    )
      return yield* new SidebarSectionError({
        reason: "thread_unavailable",
        outcomeUnknown: false,
      });
    const pinAdded = input.sectionId !== null && thread.pinnedAt === null;
    if (pinAdded) {
      yield* threads
        .dispatch({
          type: "thread.pin",
          onlyIfActive: true,
          threadId: input.threadId,
          commandId: CommandId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie)),
        })
        .pipe(
          Effect.mapError(
            () => new SidebarSectionError({ reason: "thread_unavailable", outcomeUnknown: true }),
          ),
        );
    }
    yield* invoke(target, {
      type: "assign",
      threadId: input.threadId,
      sectionId: input.sectionId,
      expectedSectionId: previous,
    }).pipe(
      Effect.mapError((error) =>
        pinAdded && !error.outcomeUnknown
          ? new SidebarSectionError({ reason: error.reason, outcomeUnknown: true })
          : error,
      ),
    );
    const after = yield* list(target).pipe(
      Effect.mapError(
        () => new SidebarSectionError({ reason: "readback_failed", outcomeUnknown: true }),
      ),
    );
    const actual = after.sections.filter((section) => section.threadIds.includes(input.threadId));
    const pinned = yield* threads
      .getThreadShell(input.threadId)
      .pipe(
        Effect.mapError(
          () => new SidebarSectionError({ reason: "readback_failed", outcomeUnknown: true }),
        ),
      );
    if (
      (input.sectionId === null
        ? actual.length !== 0
        : actual.length !== 1 || actual[0]?.id !== input.sectionId) ||
      pinned === null ||
      (input.sectionId !== null && pinned.pinnedAt === null)
    )
      return yield* new SidebarSectionError({ reason: "readback_failed", outcomeUnknown: true });
    return {
      ...after,
      threadId: input.threadId,
      sectionId: input.sectionId,
      verified: true as const,
    };
  });
  return SidebarSections.of({
    connect,
    respond,
    list,
    assign,
    clients: Effect.sync(() => [...connections.values()].map(({ identity }) => identity)),
  });
});
export const layer = Layer.effect(SidebarSections, make);
