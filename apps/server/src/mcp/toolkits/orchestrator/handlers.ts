import { SymphonyBusError, SymphonyBusRequest } from "@t3tools/contracts";
import * as SymphonyBusGateway from "../../../symphony/SymphonyBusGateway.ts";
import * as ThreadParticipationControl from "../../../symphony/ThreadParticipationControl.ts";
import { OrchestratorMcpFailure, SymphonyParticipationMcpInput } from "@t3tools/contracts";
import { OrchestratorToolkit } from "./tools.ts";
import * as Effect from "effect/Effect";

import { readCaller, captureThreadAuthority } from "../../threadAccess.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as ThreadMetadataMcpService from "../../ThreadMetadataMcpService.ts";

const participation = Effect.fn("mcp.symphonyParticipation")(
  function* (input: typeof SymphonyParticipationMcpInput.Type) {
    const { scope } = yield* readCaller();
    const threadId = input.threadId ?? scope.thread?.threadId;
    if (threadId === undefined)
      return yield* new OrchestratorMcpFailure({
        code: "target_required",
        message: "Pass threadId: this MCP client is not running inside a T3 conversation.",
      });
    const service = yield* ThreadParticipationControl.ThreadParticipationControl;
    if (input.action === "status") return yield* service.status({ threadId });
    if (input.clientRequestId === undefined || input.expectedGeneration === undefined)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "Join and leave need clientRequestId and expectedGeneration from status.",
      });
    const mutation = {
      threadId,
      clientRequestId: input.clientRequestId,
      expectedGeneration: input.expectedGeneration,
    };
    if (input.action === "leave") return yield* service.leave(mutation);
    if (input.identity === undefined || input.topics === undefined)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "Join needs an explicit v12 identity and topics array.",
      });
    return yield* service.join({ ...mutation, identity: input.identity, topics: input.topics });
  },
  Effect.mapError((cause) =>
    cause._tag === "OrchestratorMcpFailure"
      ? cause
      : new OrchestratorMcpFailure({
          code: cause.code === "forbidden" ? "capability_denied" : "invalid_request",
          message: cause.message,
        }),
  ),
);

const bus = Effect.fn("mcp.symphonyBus")(function* (input: SymphonyBusRequest) {
  const { scope } = yield* readCaller();
  const caller = yield* McpInvocationContext.requireThreadScope(scope, "t3_symphony_bus");
  const authority = yield* captureThreadAuthority(input.operation === "publish");
  const authorization = authority.pipe(
    Effect.mapError(
      (cause) =>
        new SymphonyBusError({
          code: "revoked",
          message:
            "The conversation's credential or publication authority changed. Reconcile any uncertain publication with its original key.",
          cause,
        }),
    ),
  );
  return yield* (yield* SymphonyBusGateway.SymphonyBusGateway)
    .call(
      {
        environmentId: scope.environmentId,
        threadId: caller.thread.threadId,
        mcpCredentialId: caller.thread.providerSessionId,
        authorization,
      },
      input,
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new OrchestratorMcpFailure({
            code: cause.code === "forbidden" ? "capability_denied" : "orchestration_error",
            message: cause.message,
          }),
      ),
    );
});

const handlers = {
  t3_symphony_bus: McpToolAccess.either(
    (input) => input.operation === "publish",
    McpToolAccess.actsAsCaller(bus),
    McpToolAccess.readsAsCaller(bus),
  ),
  t3_symphony_participation: McpToolAccess.either(
    (input) => input.action === "status",
    McpToolAccess.reads(participation),
    McpToolAccess.writesThreads((input) => [input.threadId], participation),
  ),
  orchestrator_capabilities: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.capabilities(scope, input);
    }),
  ),
  delegate_task: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.delegateTask(scope, input);
    }),
  ),
  task_status: McpToolAccess.actsAsCaller(({ taskId }) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.taskStatus(scope, taskId);
    }),
  ),
  task_cancel: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.cancelTask(scope, input);
    }),
  ),
  t3_workflow_stop: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { threads } = yield* readCaller();
        return yield* threads.stopWorkflow(input).pipe(
          Effect.as({}),
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({
                code:
                  cause.reason === "unavailable" || cause.reason === "stop-failed"
                    ? "orchestration_error"
                    : "invalid_request",
                message: cause.message,
              }),
          ),
        );
      }),
  ),
  t3_background_wait: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { scope, threads } = yield* readCaller();
      const caller = yield* McpInvocationContext.requireThreadScope(scope, "t3_background_wait");
      return yield* threads
        .awaitBackgroundTasks({
          threadId: caller.thread.threadId,
          taskIds: input.taskIds,
          awaited: input.waiting ?? true,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({
                code: cause.reason === "unsupported" ? "invalid_request" : "orchestration_error",
                message: cause.message,
              }),
          ),
        );
    }),
  ),
  schedule_task: McpToolAccess.either(
    (input) => input.scheduledTaskId === undefined,
    McpToolAccess.startsThreads(
      () => ({}),
      ({ prompt, schedule, ...input }) =>
        Effect.gen(function* () {
          if (prompt === undefined || schedule === undefined) {
            return yield* new OrchestratorMcpFailure({
              code: "invalid_request",
              message: "A new scheduled task needs `prompt` and `schedule`.",
            });
          }
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          return yield* service.scheduleTask(scope, { ...input, prompt, schedule });
        }),
    ),
    McpToolAccess.writes(
      ({ scheduledTaskId, prompt, title, schedule, enabled, bindToCurrentThread }) =>
        Effect.gen(function* () {
          if (scheduledTaskId === undefined) return yield* Effect.die("unreachable");
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          return yield* service.updateScheduledTask(scope, {
            scheduledTaskId,
            prompt,
            title,
            schedule,
            enabled,
            bindToCurrentThread,
          });
        }),
    ),
  ),
  list_scheduled_tasks: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.listScheduledTasks(scope, input);
    }),
  ),
  delete_scheduled_task: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.deleteScheduledTask(scope, input);
    }),
  ),
  request_secret: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.requestSecret(scope, input);
    }),
  ),
  create_threads: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.createThreads(scope, input);
    }),
  ),
  t3_thread_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.listThreads(scope, input);
    }),
  ),
  t3_thread_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.readThread(scope, input);
    }),
  ),
  t3_thread_update: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const service = yield* ThreadMetadataMcpService.ThreadMetadataMcpService;
        return yield* service.update(scope, input);
      }),
  ),
  t3_thread_send: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        return yield* service.sendToThread(scope, input);
      }),
  ),
  t3_thread_wait: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.waitForThread(scope, input);
    }),
  ),
  t3_thread_interrupt: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        return yield* service.interruptThread(scope, input);
      }),
  ),
} satisfies McpToolAccess.Handlers<typeof OrchestratorToolkit.tools>;

export const layer = McpToolAccess.toLayer(OrchestratorToolkit, handlers);
