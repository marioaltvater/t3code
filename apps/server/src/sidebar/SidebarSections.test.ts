import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  ThreadId,
  type SidebarSectionEvent,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SidebarSections from "./SidebarSections.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
const environmentId = EnvironmentId.make("env");
const threadId = ThreadId.make("research");
const sessionId = AuthSessionId.make("session");
const registration = { environmentId, clientId: "desktop", surface: "desktop" as const };
const target = { environmentId, clientId: "desktop" };
const setup = Effect.gen(function* () {
  let pinned = false;
  const commands: string[] = [];
  const thread = () =>
    ({
      id: threadId,
      pinnedAt: pinned ? "now" : null,
      deletedAt: null,
      archivedAt: null,
      snoozedUntil: null,
      settledOverride: null,
    }) as OrchestrationV2ThreadShell;
  const service = yield* SidebarSections.SidebarSections.pipe(
    Effect.provide(
      SidebarSections.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeCrypto.layer,
            Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(environmentId),
            }),
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: () => Effect.sync(thread),
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command.type);
                  pinned = true;
                  return { sequence: 1, storedEvents: [] };
                }),
            }),
          ),
        ),
      ),
    ),
  );
  return { service, commands };
});
function snapshot(event: SidebarSectionEvent, ids: readonly ThreadId[] = []) {
  const { request: _, ...identity } = event;
  return {
    ...identity,
    sections: [
      { id: "chief", name: "Chief of Staff", collapsed: true, threadIds: [] },
      { id: "talos", name: "Talos", collapsed: false, threadIds: ids },
    ],
  };
}
it.effect("routes list/assign/readback to the exact connection and pins only once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, commands } = yield* setup;
      const events = yield* service.connect(sessionId, registration);
      const operations: string[] = [];
      let ids: readonly ThreadId[] = [];
      yield* events.pipe(
        Stream.runForEach((event) => {
          operations.push(event.request.type);
          if (event.request.type === "assign")
            ids = event.request.sectionId === null ? [] : [threadId];
          return service.respond(sessionId, {
            ...snapshot(event),
            requestId: event.request.requestId,
            result: { ok: true, snapshot: snapshot(event, ids) },
          });
        }),
        Effect.forkScoped,
      );
      const assigned = yield* service.assign({ ...target, threadId, sectionId: "talos" });
      expect(assigned.verified).toBe(true);
      expect(assigned.sections[1]?.threadIds).toEqual([threadId]);
      expect(operations).toEqual(["list", "assign", "list"]);
      yield* service.assign({ ...target, threadId, sectionId: "talos" });
      expect(commands).toEqual(["thread.pin"]);
      const conflict = yield* service
        .assign({ ...target, threadId, sectionId: "chief" })
        .pipe(Effect.flip);
      expect(conflict.reason).toBe("membership_conflict");
      yield* service.assign({ ...target, threadId, sectionId: null, mode: "move" });
      expect(commands).toEqual(["thread.pin"]);
    }),
  ),
);
it.effect("rejects wrong, offline and ambiguous clients without routing a mutation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service, commands } = yield* setup;
      expect((yield* service.list(target).pipe(Effect.flip)).reason).toBe("client_unavailable");
      const _events1 = yield* service.connect(sessionId, registration);
      const _events2 = yield* service.connect(sessionId, registration);
      expect((yield* service.list(target).pipe(Effect.flip)).reason).toBe("client_ambiguous");
      expect(
        (yield* service
          .list({ ...target, environmentId: EnvironmentId.make("wrong") })
          .pipe(Effect.flip)).reason,
      ).toBe("wrong_environment");
      expect((yield* service.list({ ...target, clientId: "web" }).pipe(Effect.flip)).reason).toBe(
        "client_unavailable",
      );
      expect(commands).toEqual([]);
    }),
  ),
);
it.effect("fails disconnected pending requests and does not fall back to another client", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service } = yield* setup;
      const connectionScope = yield* Scope.make();
      const events = yield* service
        .connect(sessionId, registration)
        .pipe(Effect.provideService(Scope.Scope, connectionScope));
      const received = yield* Deferred.make<void>();
      yield* events.pipe(
        Stream.runForEach(() => Deferred.succeed(received, undefined)),
        Effect.forkScoped,
      );
      const waiting = yield* service.list(target).pipe(Effect.forkScoped);
      yield* Deferred.await(received);
      yield* Scope.close(connectionScope, Exit.void);
      const error = yield* Fiber.join(waiting).pipe(Effect.flip);
      expect(error.reason).toBe("client_disconnected");
      expect(yield* service.clients).toEqual([]);
    }),
  ),
);
it.effect("rejects responses from another session and detects failed final readback", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service } = yield* setup;
      const events = yield* service.connect(sessionId, registration);
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const response = {
              ...snapshot(event),
              requestId: event.request.requestId,
              result: { ok: true as const, snapshot: snapshot(event) },
            };
            expect(
              (yield* service.respond(AuthSessionId.make("wrong"), response).pipe(Effect.flip))
                .reason,
            ).toBe("invalid_response");
            yield* service.respond(sessionId, response);
          }),
        ),
        Effect.forkScoped,
      );
      expect(
        (yield* service.assign({ ...target, threadId, sectionId: "talos" }).pipe(Effect.flip))
          .reason,
      ).toBe("readback_failed");
    }),
  ),
);
it.effect("bounds silent clients and reports an unknown write outcome", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { service } = yield* setup;
      const events = yield* service.connect(sessionId, registration);
      const writing = yield* Deferred.make<void>();
      yield* events.pipe(
        Stream.runForEach((event) =>
          event.request.type === "list"
            ? service.respond(sessionId, {
                ...snapshot(event),
                requestId: event.request.requestId,
                result: { ok: true, snapshot: snapshot(event) },
              })
            : Deferred.succeed(writing, undefined),
        ),
        Effect.forkScoped,
      );
      const waiting = yield* service
        .assign({ ...target, threadId, sectionId: "talos" })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(writing);
      yield* TestClock.adjust("10 seconds");
      const error = yield* Fiber.join(waiting).pipe(Effect.flip);
      expect(error.reason).toBe("timeout");
      expect(error.outcomeUnknown).toBe(true);
    }),
  ),
);
