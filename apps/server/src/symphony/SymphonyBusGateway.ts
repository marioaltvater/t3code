import {
  SymphonyBusError,
  SymphonyBusRequest,
  type SymphonyBusResult,
  type SymphonyBusConfiguration,
  type SymphonyParticipationScope,
  type SymphonyRuntimeIdentity,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Participation from "./ThreadParticipationService.ts";
import * as Transport from "./SymphonyBusTransport.ts";

export const symphonyBusConfigurationRevision = (configuration: SymphonyBusConfiguration) =>
  `native-mcp-v1:${configuration.endpoint}`;
interface Caller extends SymphonyParticipationScope {
  readonly mcpCredentialId: string;
  readonly authorization: Effect.Effect<void, SymphonyBusError>;
}
export class SymphonyBusGateway extends Context.Service<
  SymphonyBusGateway,
  {
    readonly runtimeIdentity: (
      caller: Caller & Pick<SymphonyRuntimeIdentity, "providerInstanceId">,
    ) => Effect.Effect<SymphonyRuntimeIdentity, SymphonyBusError>;
    readonly call: (
      caller: Caller,
      input: SymphonyBusRequest,
    ) => Effect.Effect<SymphonyBusResult, SymphonyBusError>;
  }
>()("t3/symphony/SymphonyBusGateway") {}
const decodeRequest = Schema.decodeUnknownEffect(SymphonyBusRequest);
const unavailable = (cause: unknown) =>
  new SymphonyBusError({
    code: "unavailable",
    message: "Could not resolve conversation bus participation.",
    cause,
  });
const revoked = () =>
  new SymphonyBusError({
    code: "revoked",
    message:
      "Conversation participation or caller authority changed during this request. No response was delivered; preserve the original publication key when reconciling.",
  });

const make = Effect.gen(function* () {
  const participation = yield* Participation.ThreadParticipationService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const transport = yield* Transport.SymphonyBusTransport;
  const environmentId = yield* environment.getEnvironmentId;
  const runtimeIdentity = Effect.fn("SymphonyBusGateway.runtimeIdentity")(function* (
    caller: Caller & Pick<SymphonyRuntimeIdentity, "providerInstanceId">,
  ) {
    yield* caller.authorization;
    if (caller.environmentId !== environmentId || !caller.mcpCredentialId)
      return yield* new SymphonyBusError({
        code: "forbidden",
        message: "Use the authenticated MCP credential for this conversation and environment.",
      });
    return {
      environmentId,
      threadId: caller.threadId,
      providerInstanceId: caller.providerInstanceId,
      mcpCredentialId: caller.mcpCredentialId,
    } satisfies SymphonyRuntimeIdentity;
  });
  const call = Effect.fn("SymphonyBusGateway.call")(function* (
    caller: Caller,
    raw: SymphonyBusRequest,
  ): Effect.fn.Return<SymphonyBusResult, SymphonyBusError> {
    yield* caller.authorization;
    if (caller.environmentId !== environmentId || !caller.mcpCredentialId)
      return yield* new SymphonyBusError({
        code: "forbidden",
        message: "Use the authenticated MCP credential for this conversation and environment.",
      });
    const input = yield* decodeRequest(raw).pipe(
      Effect.mapError(
        (cause) =>
          new SymphonyBusError({
            code: "invalid_request",
            message: "Use a supported bounded bus operation.",
            cause,
          }),
      ),
    );
    const record = yield* participation.status(caller).pipe(Effect.mapError(unavailable));
    const result = (
      state: SymphonyBusResult["state"],
      reason: string | null,
    ): SymphonyBusResult => ({
      state,
      reason,
      identity: record.identity,
      generation: record.desiredGeneration,
      payload: null,
    });
    if (record.desiredState !== "joined") return result("quiet", null);
    const binding = record.nativeBinding;
    if (
      binding?.kind !== "native-mcp" ||
      record.nativeState !== "applied" ||
      record.appliedGeneration !== record.desiredGeneration
    )
      return result("pending", "native_reconfigure_required");
    if (
      binding.mcpCredentialId !== caller.mcpCredentialId ||
      binding.nativeGeneration !== record.nativeGeneration
    )
      return yield* revoked();
    const configuration = (yield* settings.getSettings.pipe(Effect.mapError(unavailable)))
      .symphonyBus;
    if (configuration === null) return result("pending", "bus_not_configured");
    if (binding.configurationRevision !== symphonyBusConfigurationRevision(configuration))
      return result("pending", "native_reconfigure_required");
    if (!record.identity || !record.principal || !record.role) return yield* unavailable(null);
    const [, principal, role] = record.identity.split(":");
    if (principal !== record.principal || role !== record.role) return yield* unavailable(null);
    const publication = input.publication;
    if (input.operation === "publish") {
      if (
        !publication ||
        !publication.topics.length ||
        publication.topics.length > 32 ||
        (publication.deliverTo?.length ?? 0) > 16
      )
        return yield* new SymphonyBusError({
          code: "invalid_request",
          message: "Publish requires explicit topics, content and a stable idempotency key.",
        });
      if ((publication.deliverTo ?? []).some((id) => id.length > 256 || /[\x00-\x20]/.test(id)))
        return yield* new SymphonyBusError({
          code: "invalid_request",
          message: "Direct recipients must be bounded agent addresses without whitespace.",
        });
      const direct = new Set(
        (publication.deliverTo ?? [])
          .filter((id) => id.length <= 256 && !/[\x00-\x20]/.test(id))
          .map((id) => `agent:${id}`),
      );
      if ([...direct].some((topic) => !publication.topics.includes(topic)))
        return yield* new SymphonyBusError({
          code: "forbidden",
          message: "Every direct recipient needs its matching explicit agent topic.",
        });
      if (publication.topics.some((topic) => !record.topics.includes(topic) && !direct.has(topic)))
        return yield* new SymphonyBusError({
          code: "forbidden",
          message:
            "Publish only within this conversation's topics or an explicitly addressed direct handoff.",
        });
    }
    const assertCurrent = Effect.gen(function* () {
      yield* caller.authorization;
      const current = yield* participation.status(caller).pipe(Effect.mapError(unavailable));
      const currentConfiguration = (yield* settings.getSettings.pipe(Effect.mapError(unavailable)))
        .symphonyBus;
      if (
        current.desiredState !== "joined" ||
        current.nativeState !== "applied" ||
        current.identity !== record.identity ||
        current.desiredGeneration !== record.desiredGeneration ||
        current.appliedGeneration !== record.appliedGeneration ||
        current.nativeGeneration !== record.nativeGeneration ||
        current.nativeBinding?.kind !== "native-mcp" ||
        current.nativeBinding.mcpCredentialId !== caller.mcpCredentialId ||
        currentConfiguration === null ||
        current.nativeBinding.configurationRevision !==
          symphonyBusConfigurationRevision(currentConfiguration)
      )
        return yield* revoked();
    });
    const args =
      input.operation === "inbox"
        ? { after_seq: input.afterSeq ?? 0, limit: input.limit ?? 12, ack: false }
        : input.operation === "publish" && publication
          ? {
              type: publication.type,
              subject: publication.subject,
              body: publication.body,
              topics: publication.topics,
              deliver_to: publication.deliverTo ?? [],
              idempotency_key: publication.idempotencyKey,
              ...(publication.inReplyTo === undefined
                ? {}
                : {
                    in_reply_to: publication.inReplyTo,
                    refs: { urls: [`symphony:in_reply_to:${publication.inReplyTo}`] },
                  }),
            }
          : {};
    const payload = yield* transport.exchange({
      endpoint: configuration.endpoint,
      identity: record.identity,
      principal: record.principal,
      role: record.role,
      topics: record.topics,
      operation: input.operation,
      args,
      assertCurrent,
    });
    yield* assertCurrent;
    return { ...result("ready", null), payload };
  });
  return SymphonyBusGateway.of({ call, runtimeIdentity });
});
export const layer = Layer.effect(SymphonyBusGateway, make);
