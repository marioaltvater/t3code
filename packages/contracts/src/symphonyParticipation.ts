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
import { ProviderInstanceId } from "./providerInstance.ts";

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
const SymphonyPluginBinding = Schema.Struct({
  kind: Schema.optional(Schema.Literal("plugin-session")),
  nativeThreadId: TrimmedNonEmptyString,
  nativeSessionId: TrimmedNonEmptyString,
  providerSessionId: ProviderSessionId,
  harnessPid: PositiveInt,
  harnessStart: TrimmedNonEmptyString,
  pluginGeneration: PositiveInt,
});
const SymphonyMcpBinding = Schema.Struct({
  kind: Schema.Literal("native-mcp"),
  nativeThreadId: TrimmedNonEmptyString,
  nativeSessionId: TrimmedNonEmptyString,
  providerSessionId: ProviderSessionId,
  // A credential reference, never the bearer token. It is distinct from the provider runtime ID.
  mcpCredentialId: TrimmedNonEmptyString,
  configurationRevision: TrimmedNonEmptyString,
  nativeGeneration: PositiveInt,
  launcherPid: Schema.optional(PositiveInt),
});
export const SymphonyNativeBinding = Schema.Union([SymphonyPluginBinding, SymphonyMcpBinding]);
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

export const SymphonyBusConfiguration = Schema.Struct({
  endpoint: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)).check(
    Schema.makeFilter(
      (value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      },
      { message: "Use an HTTP MCP endpoint without credentials, query or fragment." },
    ),
  ),
});
export type SymphonyBusConfiguration = typeof SymphonyBusConfiguration.Type;

export const SymphonyBusRequest = Schema.Struct({
  operation: Schema.Literals(["whoami", "inbox", "publish"]),
  afterSeq: Schema.optional(NonNegativeInt),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
  publication: Schema.optional(
    Schema.Struct({
      type: TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z_]{1,32}$/)),
      subject: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
      body: Schema.String.check(Schema.isMaxLength(20000)),
      topics: Schema.Array(TrimmedNonEmptyString),
      deliverTo: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
      idempotencyKey: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
      inReplyTo: Schema.optional(PositiveInt),
    }),
  ),
});
export type SymphonyBusRequest = typeof SymphonyBusRequest.Type;
export const SymphonyBusResult = Schema.Struct({
  state: Schema.Literals(["quiet", "pending", "ready"]),
  reason: Schema.NullOr(TrimmedNonEmptyString),
  identity: Schema.NullOr(SymphonyParticipantIdentity),
  generation: NonNegativeInt,
  payload: Schema.NullOr(Schema.Json),
});
export type SymphonyBusResult = typeof SymphonyBusResult.Type;
export const SymphonyRuntimeIdentity = Schema.Struct({
  ...SymphonyParticipationScope.fields,
  providerInstanceId: ProviderInstanceId,
  mcpCredentialId: TrimmedNonEmptyString,
});
export type SymphonyRuntimeIdentity = typeof SymphonyRuntimeIdentity.Type;
export class SymphonyBusError extends Schema.TaggedError<SymphonyBusError>()("SymphonyBusError", {
  code: Schema.Literals([
    "unavailable",
    "identity_mismatch",
    "scope_mismatch",
    "revoked",
    "forbidden",
    "invalid_request",
  ]),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
