import { expect, it, vi } from "vite-plus/test";
import type { DesktopControllerEvent } from "@t3tools/contracts";
import { makeControllerDictation } from "./dictation.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

it("does not record until the renderer accepts a pinned destination, and never types into the OS", async () => {
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn(async (args: string[]) =>
    args[0] === "start"
      ? { session_id: TOKEN }
      : args[0] === "result"
        ? { text: "A private draft" }
        : {},
  );
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.press();
  expect(events).toEqual([]);
  capture.setReady(true);
  capture.press();
  expect(run).not.toHaveBeenCalled();
  const id = events[0]!.captureId;
  await capture.accept(id);
  capture.release();
  await capture.idle();
  expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
  expect(run.mock.calls.every(([args]) => args.at(-1) === "--json")).toBe(true);
  expect(events.at(-1)).toEqual({ type: "dictation", captureId: id, text: "A private draft" });
  await capture.acknowledge("unrelated-capture");
  expect(run.mock.calls.map(([args]) => args[0])).not.toContain("release");
  await capture.acknowledge(id);
  expect(run.mock.calls.at(-1)?.[0]).toEqual(["release", TOKEN, "--json"]);
  await capture.acknowledge(id);
  expect(run.mock.calls.filter(([args]) => args[0] === "release")).toHaveLength(1);
});

it("ignores late acceptance after a quick press and release", async () => {
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn(async () => ({ session_id: TOKEN }));
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.setReady(true);
  capture.press();
  capture.release();
  await capture.accept(events[0]!.captureId);
  expect(run).not.toHaveBeenCalled();
});

it("serializes key release that arrives while recording is starting", async () => {
  let started!: (value: { session_id: string }) => void;
  const recording = new Promise<{ session_id: string }>((resolve) => {
    started = resolve;
  });
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn((args: string[]) =>
    args[0] === "start"
      ? recording
      : Promise.resolve(args[0] === "result" ? { text: "Finished" } : {}),
  );
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.setReady(true);
  capture.press();
  const accepted = capture.accept(events[0]!.captureId);
  capture.release();
  started({ session_id: TOKEN });
  await accepted;
  await capture.idle();
  expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
  expect(events.at(-1)?.type).toBe("dictation");
});

it("cancels its exact owned session after disconnect during startup and suppresses delivery", async () => {
  let started!: (value: { session_id: string }) => void;
  const recording = new Promise<{ session_id: string }>((resolve) => {
    started = resolve;
  });
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn((args: string[]) => (args[0] === "start" ? recording : Promise.resolve({})));
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.setReady(true);
  capture.press();
  const accepted = capture.accept(events[0]!.captureId);
  capture.setReady(false);
  started({ session_id: TOKEN });
  await accepted;
  await capture.idle();
  expect(run.mock.calls[1]?.[0]).toEqual(["cancel", TOKEN, "--json"]);
  expect(events.some((event) => event.type === "dictation")).toBe(false);
});

it("rejects another capture's token and reports a busy local microphone", async () => {
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn(async () => {
    throw new Error("A recording or transcription is already in progress");
  });
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.setReady(true);
  capture.press();
  await capture.accept("another-capture");
  expect(run).not.toHaveBeenCalled();
  await capture.accept(events[0]!.captureId);
  expect(events.at(-1)).toMatchObject({
    type: "error",
    message: "A recording or transcription is already in progress",
  });
});

it("cancels the owned recorder if stopping fails, without delivering text", async () => {
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === "start") return { session_id: TOKEN };
    if (args[0] === "stop") throw new Error("Recorder did not stop");
    return {};
  });
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.setReady(true);
  capture.press();
  await capture.accept(events[0]!.captureId);
  capture.release();
  await capture.idle();
  expect(run.mock.calls.at(-1)?.[0]).toEqual(["cancel", TOKEN, "--json"]);
  expect(events.at(-1)).toMatchObject({ type: "error", message: "Recorder did not stop" });
  expect(events.some((event) => event.type === "dictation")).toBe(false);
});

it("does not deliver an obsolete transcription after renderer reload and reactivation", async () => {
  let finish!: (value: { text: string }) => void;
  let markResultStarted!: () => void;
  const resultStarted = new Promise<void>((resolve) => {
    markResultStarted = resolve;
  });
  const result = new Promise<{ text: string }>((resolve) => {
    finish = resolve;
  });
  const events: DesktopControllerEvent[] = [];
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === "start") return { session_id: TOKEN };
    if (args[0] === "result") {
      markResultStarted();
      return result;
    }
    return {};
  });
  const capture = makeControllerDictation(run, (event) => events.push(event));
  capture.setReady(true);
  capture.press();
  await capture.accept(events[0]!.captureId);
  capture.release();
  await resultStarted;
  capture.setReady(false);
  capture.setReady(true);
  finish({ text: "Obsolete destination" });
  await capture.idle();
  expect(events.some((event) => event.type === "dictation")).toBe(false);
  expect(run.mock.calls.at(-1)?.[0]).toEqual(["cancel", TOKEN, "--json"]);
});

it("stops a held recording at the duration limit and ignores a later physical release", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async (args: string[]) =>
      args[0] === "start"
        ? { session_id: TOKEN }
        : args[0] === "result"
          ? { text: "Finished at limit" }
          : {},
    );
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    await capture.accept(events[0]!.captureId);
    await vi.advanceTimersByTimeAsync(60_000);
    await capture.idle();
    capture.release();
    expect(run.mock.calls.filter(([args]) => args[0] === "stop")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "dictation", text: "Finished at limit" });
  } finally {
    vi.useRealTimers();
  }
});
