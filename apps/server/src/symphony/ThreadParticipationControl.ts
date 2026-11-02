import {
  SymphonyParticipationError,
  type ThreadId,
  type SymphonyParticipation,
  type SymphonyParticipationJoinInput,
  type SymphonyParticipationLeaveInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import {
  DispatchModeLimit,
  exceededDispatchModeLimit,
} from "../orchestration-v2/DispatchModeLimit.ts";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as Participation from "./ThreadParticipationService.ts";

export class ThreadParticipationControl extends Context.Service<
  ThreadParticipationControl,
  {
    readonly status: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly join: (
      input: Omit<SymphonyParticipationJoinInput, "environmentId">,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
    readonly leave: (
      input: Omit<SymphonyParticipationLeaveInput, "environmentId">,
    ) => Effect.Effect<SymphonyParticipation, SymphonyParticipationError>;
  }
>()("t3/symphony/ThreadParticipationControl") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  const participation = yield* Participation.ThreadParticipationService;
  const environmentId = yield* environment.getEnvironmentId;

  const checkThread = Effect.fn("ThreadParticipationControl.checkThread")(function* (
    threadId: ThreadId,
    joining: boolean,
  ) {
    const thread = yield* projection.getThread(threadId).pipe(
      Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }),
      Effect.mapError(
        (cause) =>
          new SymphonyParticipationError({
            code: "persistence_error",
            message: "Could not read the target conversation.",
            cause,
          }),
      ),
    );
    const limit = yield* DispatchModeLimit;
    if (
      limit !== undefined &&
      (thread === null
        ? limit.runtimeMode !== "full-access" || limit.interactionMode !== "default"
        : exceededDispatchModeLimit(limit, thread) !== undefined)
    ) {
      return yield* new SymphonyParticipationError({
        code: "forbidden",
        message:
          "The target conversation exceeds this caller's permissions. Missing-target recovery requires full access.",
      });
    }
    if (joining && (thread === null || thread.deletedAt !== null || thread.archivedAt !== null)) {
      return yield* new SymphonyParticipationError({
        code: "invalid",
        message: "Choose an existing, unarchived conversation to join the bus.",
      });
    }
    return { environmentId, threadId };
  });
  // Participation outlives projection deletion. Authorized callers must retain status/leave recovery.
  const status = Effect.fn("ThreadParticipationControl.status")(function* (input: {
    readonly threadId: ThreadId;
  }) {
    return yield* participation.status({ environmentId, threadId: input.threadId });
  });
  const join = Effect.fn("ThreadParticipationControl.join")(
    function* (input: Omit<SymphonyParticipationJoinInput, "environmentId">) {
      return yield* participation.join({ ...input, ...(yield* checkThread(input.threadId, true)) });
    },
    (effect) =>
      sql.withTransaction(effect).pipe(
        Effect.mapError((cause) =>
          cause._tag === "SymphonyParticipationError"
            ? cause
            : new SymphonyParticipationError({
                code: "persistence_error",
                message: "Could not change conversation participation.",
                cause,
              }),
        ),
      ),
  );
  const leave = Effect.fn("ThreadParticipationControl.leave")(
    function* (input: Omit<SymphonyParticipationLeaveInput, "environmentId">) {
      return yield* participation.leave({
        ...input,
        ...(yield* checkThread(input.threadId, false)),
      });
    },
    (effect) =>
      sql.withTransaction(effect).pipe(
        Effect.mapError((cause) =>
          cause._tag === "SymphonyParticipationError"
            ? cause
            : new SymphonyParticipationError({
                code: "persistence_error",
                message: "Could not change conversation participation.",
                cause,
              }),
        ),
      ),
  );
  return ThreadParticipationControl.of({ status, join, leave });
});

export const layer = Layer.effect(ThreadParticipationControl, make);
