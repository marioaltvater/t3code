import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { createEnvironmentRpcCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { SidebarSectionError, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { connectionAtomRuntime } from "../connection/runtime";
import { getClientId } from "../lib/backgroundActivityReporter";
import { handleSidebarSectionRequest } from "../sidebarSectionClient";
import { appAtomRegistry } from "./atomRegistry";
import { subscribeSidebarSections } from "./sidebarSectionsSubscription";

const isSidebarSectionError = Schema.is(SidebarSectionError);

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (typeof window === "undefined") return;
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const clientId = getClientId();
    const respond = createEnvironmentRpcCommand(connectionAtomRuntime, {
      label: "sidebar:respond",
      tag: WS_METHODS.sidebarSectionsRespond,
    });
    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.map((entries) => [...entries.keys()]),
      Stream.changesWith(
        (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
      ),
      Stream.switchMap((ids) =>
        Stream.mergeAll(
          ids.map((environmentId) =>
            registry.followStream(
              environmentId,
              subscribeSidebarSections(
                environmentId,
                clientId,
                window.desktopBridge ? "desktop" : "web",
              ).pipe(
                Stream.mapEffect((event) =>
                  Effect.promise(async () => {
                    let result;
                    try {
                      if (event.environmentId !== environmentId || event.clientId !== clientId)
                        throw new SidebarSectionError({
                          reason: "invalid_response",
                          outcomeUnknown: false,
                        });
                      result = { ok: true as const, snapshot: handleSidebarSectionRequest(event) };
                    } catch (error) {
                      result = {
                        ok: false as const,
                        error: isSidebarSectionError(error)
                          ? error
                          : new SidebarSectionError({
                              reason: "invalid_response",
                              outcomeUnknown: event.request.type === "assign",
                            }),
                      };
                    }
                    await runAtomCommand(appAtomRegistry, respond, {
                      environmentId,
                      input: { ...event, requestId: event.request.requestId, result },
                    });
                  }),
                ),
              ),
            ),
          ),
          { concurrency: "unbounded" },
        ),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );
  }),
);
