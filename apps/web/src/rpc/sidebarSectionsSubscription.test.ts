import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { RpcSession, WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import {
  EnvironmentAuthorizationError,
  EnvironmentId,
  WS_METHODS,
  type ServerConfig,
  type SidebarSectionEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { expect, it } from "@effect/vitest";
import { subscribeSidebarSections } from "./sidebarSectionsSubscription";

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.succeed({
      environment: { capabilities: { sidebarSections: true } },
    } as ServerConfig),
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

const harness = (id: string) =>
  Effect.gen(function* () {
    const environmentId = EnvironmentId.make(id);
    const activeSession = yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.none());
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target: new PrimaryConnectionTarget({
        environmentId,
        label: id,
        httpBaseUrl: "http://localhost",
        wsBaseUrl: "ws://localhost",
      }),
      state: yield* SubscriptionRef.make<SupervisorConnectionState>(AVAILABLE_CONNECTION_STATE),
      session: activeSession,
      prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    });
    return { environmentId, activeSession, supervisor };
  });

it.effect(
  "keeps a healthy bridge alive when another environment denies access, and retries a new session",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const healthy = yield* harness("healthy");
        const denied = yield* harness("denied");
        const healthyEvents = yield* Queue.unbounded<SidebarSectionEvent>();
        const recoveredEvents = yield* Queue.unbounded<SidebarSectionEvent>();
        const received = yield* Queue.unbounded<SidebarSectionEvent>();
        const failed = yield* Deferred.make<void>();
        const connected = yield* Deferred.make<void>();
        const healthyClient = {
          [WS_METHODS.sidebarSectionsConnect]: () => Stream.fromQueue(healthyEvents),
        } as unknown as WsRpcProtocolClient;
        const deniedClient = {
          [WS_METHODS.sidebarSectionsConnect]: () =>
            Stream.fail(
              new EnvironmentAuthorizationError({
                message: "Missing scope",
                requiredScope: "orchestration:operate",
              }),
            ).pipe(Stream.ensuring(Deferred.succeed(failed, undefined))),
        } as unknown as WsRpcProtocolClient;
        const recoveredClient = {
          [WS_METHODS.sidebarSectionsConnect]: () =>
            Stream.fromQueue(recoveredEvents).pipe(
              Stream.onStart(Deferred.succeed(connected, undefined)),
            ),
        } as unknown as WsRpcProtocolClient;
        yield* SubscriptionRef.set(healthy.activeSession, Option.some(session(healthyClient)));
        yield* SubscriptionRef.set(denied.activeSession, Option.some(session(deniedClient)));
        yield* Stream.mergeAll(
          [healthy, denied].map((env) =>
            subscribeSidebarSections(env.environmentId, "desktop", "desktop").pipe(
              Stream.provideService(EnvironmentSupervisor.EnvironmentSupervisor, env.supervisor),
            ),
          ),
          { concurrency: "unbounded" },
        ).pipe(
          Stream.runForEach((event) => Queue.offer(received, event)),
          Effect.forkScoped,
        );
        yield* Deferred.await(failed);
        const event = (environmentId: EnvironmentId, requestId: string): SidebarSectionEvent => ({
          environmentId,
          clientId: "desktop",
          connectionId: "connection",
          surface: "desktop",
          request: { type: "list", requestId },
        });
        const first = event(healthy.environmentId, "after-denial");
        yield* Queue.offer(healthyEvents, first);
        expect(yield* Queue.take(received)).toEqual(first);
        yield* SubscriptionRef.set(denied.activeSession, Option.some(session(recoveredClient)));
        yield* Deferred.await(connected);
        const second = event(denied.environmentId, "after-new-session");
        yield* Queue.offer(recoveredEvents, second);
        expect(yield* Queue.take(received)).toEqual(second);
        const third = event(healthy.environmentId, "still-healthy");
        yield* Queue.offer(healthyEvents, third);
        expect(yield* Queue.take(received)).toEqual(third);
      }),
    ),
);
