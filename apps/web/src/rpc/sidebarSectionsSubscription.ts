import { subscribeDynamic } from "@t3tools/client-runtime/rpc";
import { WS_METHODS, type EnvironmentId, type SidebarClient } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export function subscribeSidebarSections(
  environmentId: EnvironmentId,
  clientId: string,
  surface: SidebarClient["surface"],
): ReturnType<typeof subscribeDynamic<typeof WS_METHODS.sidebarSectionsConnect>> {
  return subscribeDynamic(
    WS_METHODS.sidebarSectionsConnect,
    (session) =>
      session.initialConfig.pipe(
        Effect.flatMap((config) =>
          config.environment.capabilities.sidebarSections === true
            ? Effect.succeed({ environmentId, clientId, surface })
            : Effect.never,
        ),
        Effect.catch(() => Effect.never),
      ),
    // A read-only environment must not cancel the bridges for other environments.
    // subscribeDynamic waits for a new authorized session before trying this one again.
    { onExpectedFailure: () => Effect.void },
  );
}
