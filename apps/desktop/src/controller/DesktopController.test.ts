import type { DesktopControllerEvent } from "@t3tools/contracts";
import * as NodeEvents from "node:events";
import type * as Electron from "electron";
import * as Effect from "effect/Effect";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { ElectronWindow } from "../electron/ElectronWindow.ts";
import { DesktopIpc, type DesktopIpcMethod } from "../ipc/DesktopIpc.ts";
import * as Channels from "../ipc/channels.ts";
import { DesktopWindow } from "../window/DesktopWindow.ts";
import { initializeDesktopController } from "./DesktopController.ts";

const receiver = vi.hoisted(() => ({
  ready: [] as boolean[],
  options: null as null | {
    command: (command: string) => void;
    event: (event: DesktopControllerEvent) => void;
  },
}));
vi.mock("./LinuxK0Controller.ts", () => ({
  startLinuxK0Controller: (options: NonNullable<typeof receiver.options>) => {
    receiver.options = options;
    return {
      close: async () => {},
      setReady: (value: boolean) => receiver.ready.push(value),
      setLighting: () => {},
    };
  },
}));

it.effect(
  "starts without a launcher flag and reveals T3 only for microphone-down before delivery",
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
      vi.stubEnv("T3CODE_K0_CONTROLLER", undefined);
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* initializeDesktopController();
            expect(receiver.options).not.toBeNull();
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
            main: Effect.succeedSome(main),
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

it.effect(
  "keeps input ready across route and subframe navigation, but resets on document replacement",
  () =>
    Effect.gen(function* () {
      receiver.ready = [];
      const contents = Object.assign(new NodeEvents.EventEmitter(), { id: 42 });
      const main = { webContents: contents } as unknown as Electron.BrowserWindow;
      const methods = new Map<string, DesktopIpcMethod<Error, never>>();
      vi.stubEnv("T3CODE_K0_CONTROLLER", undefined);
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* initializeDesktopController();
            const ready = methods.get(Channels.CONTROLLER_READY_CHANNEL)!;
            yield* ready.handler(true, { sender: { id: 43 } }).pipe(Effect.orDie);
            expect(receiver.ready).toEqual([]);
            yield* ready.handler(true, { sender: { id: 42 } }).pipe(Effect.orDie);
            contents.emit("did-start-loading");
            contents.emit(
              "did-start-navigation",
              {},
              "t3code-personal://app/#/settings",
              true,
              true,
            );
            contents.emit("did-start-navigation", {}, "about:blank", false, false);
            expect(receiver.ready).toEqual([true]);
            contents.emit("did-start-navigation", {}, "t3code-personal://app/", false, true);
            expect(receiver.ready).toEqual([true, false]);
            yield* ready.handler(true, { sender: { id: 42 } }).pipe(Effect.orDie);
            contents.emit("destroyed");
            expect(receiver.ready).toEqual([true, false, true, false]);
          }),
        ).pipe(
          Effect.provideService(DesktopEnvironment, {
            platform: "linux",
          } as DesktopEnvironment["Service"]),
          Effect.provideService(ElectronWindow, {
            main: Effect.succeedSome(main),
          } as ElectronWindow["Service"]),
          Effect.provideService(DesktopIpc, {
            handle: (method: DesktopIpcMethod<Error, never>) =>
              Effect.sync(() => {
                methods.set(method.channel, method);
              }),
          } as unknown as DesktopIpc["Service"]),
          Effect.provideService(DesktopWindow, {} as DesktopWindow["Service"]),
        );
      } finally {
        vi.unstubAllEnvs();
        receiver.options = null;
        receiver.ready = [];
      }
    }),
);

it.effect("does not claim the controller when explicitly disabled or outside Linux", () =>
  Effect.gen(function* () {
    for (const [platform, flag] of [
      ["linux", "0"],
      ["darwin", undefined],
    ] as const) {
      receiver.options = null;
      vi.stubEnv("T3CODE_K0_CONTROLLER", flag);
      try {
        yield* Effect.scoped(initializeDesktopController()).pipe(
          Effect.provideService(DesktopEnvironment, {
            platform,
          } as DesktopEnvironment["Service"]),
          Effect.provideService(ElectronWindow, {} as ElectronWindow["Service"]),
          Effect.provideService(DesktopIpc, {
            handle: () => Effect.void,
          } as unknown as DesktopIpc["Service"]),
          Effect.provideService(DesktopWindow, {} as DesktopWindow["Service"]),
        );
        expect(receiver.options).toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    }
  }),
);
