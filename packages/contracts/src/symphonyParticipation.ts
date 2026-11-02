import * as Schema from "effect/Schema";
import {
  EnvironmentId,
  ThreadId,
  ProviderSessionId,
  TrimmedNonEmptyString,
  NonNegativeInt,
  PositiveInt,
  IsoDateTime,
} from "./baseSchemas.ts";

export const SymphonyParticipantIdentity = TrimmedNonEmptyString.check(
  Schema.isPattern(
    /^v12:[A-Za-z0-9][A-Za-z0-9._@-]{0,63}:(orchestrator|planner|implementer|reviewer)(:\d{1,9})?$/,
  ),
);
export const SymphonyParticipationScope = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type SymphonyParticipationScope = typeof SymphonyParticipationScope.Type;
export const SymphonyNativeBinding = Schema.Struct({
  nativeThreadId: TrimmedNonEmptyString,
  nativeSessionId: TrimmedNonEmptyString,
  providerSessionId: ProviderSessionId,
  harnessPid: PositiveInt,
  harnessStart: TrimmedNonEmptyString,
  pluginGeneration: PositiveInt,
});
export type SymphonyNativeBinding = typeof SymphonyNativeBinding.Type;
export const SymphonyParticipation = Schema.Struct({
  ...SymphonyParticipationScope.fields,
  identity: Schema.NullOr(SymphonyParticipantIdentity),
  principal: Schema.NullOr(TrimmedNonEmptyString),
  role: Schema.NullOr(Schema.Literals(["orchestrator", "planner", "implementer", "reviewer"])),
  topics: Schema.Array(TrimmedNonEmptyString),
  appliedTopics: Schema.Array(TrimmedNonEmptyString),
  desiredState: Schema.Literals(["joined", "left"]),
  desiredGeneration: NonNegativeInt,
  appliedGeneration: NonNegativeInt,
  nativeGeneration: NonNegativeInt,
  nativeState: Schema.Literals(["detached", "reserved", "applied"]),
  nativeBinding: Schema.NullOr(SymphonyNativeBinding),
  pendingReason: Schema.NullOr(
    Schema.Literals(["native_reconfigure_required", "native_not_loaded"]),
  ),
  updatedAt: IsoDateTime,
});
export type SymphonyParticipation = typeof SymphonyParticipation.Type;
export const SymphonyParticipationJoinInput = Schema.Struct({
  ...SymphonyParticipationScope.fields,
  identity: SymphonyParticipantIdentity,
  topics: Schema.Array(TrimmedNonEmptyString),
  clientRequestId: TrimmedNonEmptyString,
  expectedGeneration: NonNegativeInt,
});
export type SymphonyParticipationJoinInput = typeof SymphonyParticipationJoinInput.Type;
export const SymphonyParticipationLeaveInput = Schema.Struct({
  ...SymphonyParticipationScope.fields,
  clientRequestId: TrimmedNonEmptyString,
  expectedGeneration: NonNegativeInt,
});
export type SymphonyParticipationLeaveInput = typeof SymphonyParticipationLeaveInput.Type;

export const SymphonyParticipationStatusInput = Schema.Struct({ threadId: ThreadId });
export const SymphonyParticipationJoinRequest = Schema.Struct({
  threadId: ThreadId,
  identity: SymphonyParticipantIdentity,
  topics: Schema.Array(TrimmedNonEmptyString),
  clientRequestId: TrimmedNonEmptyString,
  expectedGeneration: NonNegativeInt,
});
export const SymphonyParticipationLeaveRequest = Schema.Struct({
  threadId: ThreadId,
  clientRequestId: TrimmedNonEmptyString,
  expectedGeneration: NonNegativeInt,
});
export const SymphonyParticipationMcpInput = Schema.Struct({
  action: Schema.Literals(["status", "join", "leave"]),
  threadId: Schema.optional(ThreadId),
  identity: Schema.optional(SymphonyParticipantIdentity),
  topics: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  clientRequestId: Schema.optional(TrimmedNonEmptyString),
  expectedGeneration: Schema.optional(NonNegativeInt),
});

export class SymphonyParticipationError extends Schema.TaggedError<SymphonyParticipationError>()(
  "SymphonyParticipationError",
  {
    code: Schema.Literals([
      "invalid",
      "conflict",
      "identity_in_use",
      "persistence_error",
      "forbidden",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
