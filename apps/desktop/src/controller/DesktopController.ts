import type { DesktopControllerEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as Channels from "../ipc/channels.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { startLinuxK0Controller } from "./LinuxK0Controller.ts";

const { logWarning } = makeComponentLogger("k0-controller");
const decodeReady = Schema.decodeUnknownEffect(Schema.Boolean);
const decodeCaptureId = Schema.decodeUnknownEffect(Schema.String.check(Schema.isMaxLength(64)));

export const initializeDesktopController = Effect.fn("desktop.controller.initialize")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const warn = (message: string) => {
    void runPromise(logWarning(message));
  };
  const run = <E>(effect: Effect.Effect<void, E>) => {
    void runPromise(effect).catch((error: unknown) =>
      warn(error instanceof Error ? error.message : String(error)),
    );
  };
  const sendEvent = Effect.fn("desktop.controller.sendEvent")(function* (
    event: DesktopControllerEvent,
  ) {
    const main = yield* electronWindow.main;
    if (
      Option.isNone(main) ||
      main.value.isDestroyed() ||
      main.value.webContents.isLoadingMainFrame()
    )
      return;
    main.value.webContents.send(Channels.CONTROLLER_EVENT_CHANNEL, event);
  });
  const controller =
    environment.platform === "linux" && process.env.T3CODE_K0_CONTROLLER === "1"
      ? startLinuxK0Controller({
          command: (command) =>
            run(
              desktopWindow.dispatchMenuAction(command, { reveal: false, dropWhenLoading: true }),
            ),
          event: (event) => run(sendEvent(event)),
          warning: warn,
        })
      : null;
  let clearWindowListeners: (() => void) | undefined;
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      clearWindowListeners?.();
      await controller?.close();
    }),
  );

  yield* ipc.handle({
    channel: Channels.CONTROLLER_READY_CHANNEL,
    handler: Effect.fn("desktop.controller.ready")(function* (raw, event) {
      const main = yield* electronWindow.main;
      if (Option.isNone(main) || main.value.webContents.id !== event?.sender.id) return;
      const ready = yield* decodeReady(raw);
      clearWindowListeners?.();
      controller?.setReady(ready);
      if (!ready) return;
      const contents = main.value.webContents;
      const reset = () => controller?.setReady(false);
      contents.once("did-start-loading", reset);
      contents.once("destroyed", reset);
      clearWindowListeners = () => {
        contents.removeListener("did-start-loading", reset);
        contents.removeListener("destroyed", reset);
      };
    }),
  });
  for (const [channel, operation] of [
    [Channels.CONTROLLER_ACCEPT_DICTATION_CHANNEL, controller?.acceptDictation],
    [Channels.CONTROLLER_CANCEL_DICTATION_CHANNEL, controller?.cancelDictation],
    [Channels.CONTROLLER_ACKNOWLEDGE_DICTATION_CHANNEL, controller?.acknowledgeDictation],
  ] as const) {
    yield* ipc.handle({
      channel,
      handler: Effect.fn("desktop.controller.dictation")(function* (raw, event) {
        const main = yield* electronWindow.main;
        if (Option.isNone(main) || main.value.webContents.id !== event?.sender.id) return;
        const id = yield* decodeCaptureId(raw);
        yield* Effect.promise(() => operation?.(id) ?? Promise.resolve());
      }),
    });
  }
});
