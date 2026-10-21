import type { DesktopControllerEvent } from "@t3tools/contracts";
import type * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { ElectronWindow } from "../electron/ElectronWindow.ts";
import { DesktopIpc } from "../ipc/DesktopIpc.ts";
import { DesktopWindow } from "../window/DesktopWindow.ts";
import { initializeDesktopController } from "./DesktopController.ts";

const receiver = vi.hoisted(() => ({
  options: null as null | {
    command: (command: string) => void;
    event: (event: DesktopControllerEvent) => void;
  },
}));
vi.mock("./LinuxK0Controller.ts", () => ({
  startLinuxK0Controller: (options: NonNullable<typeof receiver.options>) => {
    receiver.options = options;
    return { close: async () => {}, setReady: () => {}, setLighting: () => {} };
  },
}));

it.effect(
  "reveals and focuses T3 only for microphone-down, before delivering the recording event",
  () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      let pending = Promise.withResolvers<void>();
      const main = {
        isDestroyed: () => false,
        webContents: {
          isLoadingMainFrame: () => false,
          send: (_channel: string, event: DesktopControllerEvent) => {
            calls.push(event);
            pending.resolve();
          },
        },
      } as unknown as Electron.BrowserWindow;
      vi.stubEnv("T3CODE_K0_CONTROLLER", "1");
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* initializeDesktopController();
            const options = receiver.options!;
            options.event({ type: "microphone", captureId: "test", pressed: true });
            yield* Effect.promise(() => pending.promise);
            expect(calls).toEqual([
              { command: "composer.focus", reveal: true, dropWhenLoading: true },
              { type: "microphone", captureId: "test", pressed: true },
            ]);
            calls.length = 0;
            pending = Promise.withResolvers<void>();
            options.event({ type: "microphone", captureId: "test", pressed: false });
            yield* Effect.promise(() => pending.promise);
            expect(calls).toEqual([{ type: "microphone", captureId: "test", pressed: false }]);
            calls.length = 0;
            pending = Promise.withResolvers<void>();
            options.command("thread.pinned.1");
            yield* Effect.promise(() => pending.promise);
            expect(calls).toEqual([
              { command: "thread.pinned.1", reveal: false, dropWhenLoading: true },
            ]);
          }),
        ).pipe(
          Effect.provideService(DesktopEnvironment, {
            platform: "linux",
          } as DesktopEnvironment["Service"]),
          Effect.provideService(ElectronWindow, {
            main: Effect.succeed(Option.some(main)),
          } as ElectronWindow["Service"]),
          Effect.provideService(DesktopIpc, {
            handle: () => Effect.void,
          } as unknown as DesktopIpc["Service"]),
          Effect.provideService(DesktopWindow, {
            dispatchMenuAction: (
              command: string,
              options?: { reveal?: boolean; dropWhenLoading?: boolean },
            ) =>
              Effect.sync(() => {
                calls.push({ command, ...options });
                if (command !== "composer.focus") pending.resolve();
              }),
          } as unknown as DesktopWindow["Service"]),
        );
      } finally {
        vi.unstubAllEnvs();
        receiver.options = null;
      }
    }),
);
