import { expect, it, vi } from "vite-plus/test";
import type { DesktopControllerEvent } from "@t3tools/contracts";
import { makeControllerDictation } from "./dictation.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

it("does not record until the renderer accepts a pinned destination, and never types into the OS", async () => {
  vi.useFakeTimers();
  try {
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
    await vi.advanceTimersByTimeAsync(299);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    await vi.advanceTimersByTimeAsync(1);
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
  } finally {
    vi.useRealTimers();
  }
});

it("accepts the pinned destination during the deferred release window", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async (args: string[]) =>
      args[0] === "start"
        ? { session_id: TOKEN }
        : args[0] === "result"
          ? { text: "Fast tap" }
          : {},
    );
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    capture.release();
    await capture.accept(events[0]!.captureId);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    await vi.advanceTimersByTimeAsync(300);
    await capture.idle();
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
    expect(events.at(-1)).toMatchObject({ type: "dictation", text: "Fast tap" });
  } finally {
    vi.useRealTimers();
  }
});

it("keeps hold-to-record behavior and ignores duplicate physical edges", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async (args: string[]) =>
      args[0] === "start" ? { session_id: TOKEN } : args[0] === "result" ? { text: "Held" } : {},
    );
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    await capture.accept(id);
    capture.press();
    capture.press();
    expect(events.filter((event) => event.type === "microphone" && event.pressed)).toHaveLength(1);
    capture.release();
    capture.release();
    await vi.advanceTimersByTimeAsync(299);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    await vi.advanceTimersByTimeAsync(1);
    await capture.idle();
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
  } finally {
    vi.useRealTimers();
  }
});

it("latches at the 299 ms boundary and stops on the next distinct press, even during startup", async () => {
  vi.useFakeTimers();
  try {
    let started!: (value: { session_id: string }) => void;
    const recording = new Promise<{ session_id: string }>((resolve) => {
      started = resolve;
    });
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn((args: string[]) =>
      args[0] === "start"
        ? recording
        : Promise.resolve(args[0] === "result" ? { text: "Latched" } : {}),
    );
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    const accepted = capture.accept(id);
    capture.release();
    await vi.advanceTimersByTimeAsync(299);
    capture.press();
    capture.release();
    await vi.advanceTimersByTimeAsync(301);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    capture.press();
    capture.press();
    capture.release();
    started({ session_id: TOKEN });
    await accepted;
    await capture.idle();
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
    expect(events.at(-1)).toMatchObject({ type: "dictation", captureId: id, text: "Latched" });
    // A second start event would let the renderer replace the original destination.
    expect(events.filter((event) => event.type === "microphone")).toEqual([
      { type: "microphone", captureId: id, pressed: true },
      { type: "microphone", captureId: id, pressed: false },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("serializes key release that arrives while recording is starting", async () => {
  vi.useFakeTimers();
  try {
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
    await vi.advanceTimersByTimeAsync(300);
    await capture.idle();
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
    expect(events.at(-1)?.type).toBe("dictation");
  } finally {
    vi.useRealTimers();
  }
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

it("cancels the deferred stop timer on disconnect and rejects late acceptance", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async () => ({ session_id: TOKEN }));
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    capture.release();
    capture.setReady(false);
    await vi.advanceTimersByTimeAsync(300);
    await capture.accept(id);
    expect(run).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("ignores acceptance after the 300 ms single-tap deadline", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async () => ({ session_id: TOKEN }));
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    capture.release();
    await vi.advanceTimersByTimeAsync(300);
    await capture.accept(id);
    expect(run).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
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
  vi.useFakeTimers();
  try {
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
    await vi.advanceTimersByTimeAsync(300);
    await capture.idle();
    expect(run.mock.calls.at(-1)?.[0]).toEqual(["cancel", TOKEN, "--json"]);
    expect(events.at(-1)).toMatchObject({ type: "error", message: "Recorder did not stop" });
    expect(events.some((event) => event.type === "dictation")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("does not deliver an obsolete transcription after renderer reload and reactivation", async () => {
  vi.useFakeTimers();
  try {
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
    await vi.advanceTimersByTimeAsync(300);
    await resultStarted;
    capture.setReady(false);
    capture.setReady(true);
    finish({ text: "Obsolete destination" });
    await capture.idle();
    expect(events.some((event) => event.type === "dictation")).toBe(false);
    expect(run.mock.calls.at(-1)?.[0]).toEqual(["cancel", TOKEN, "--json"]);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a held recording past 30 minutes until physical release", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async (args: string[]) =>
      args[0] === "start"
        ? { session_id: TOKEN }
        : args[0] === "result"
          ? { text: "Long held recording" }
          : {},
    );
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    await capture.accept(events[0]!.captureId);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    expect(events).toEqual([
      { type: "microphone", captureId: events[0]!.captureId, pressed: true },
    ]);
    capture.release();
    await vi.advanceTimersByTimeAsync(300);
    await capture.idle();
    expect(run.mock.calls.filter(([args]) => args[0] === "stop")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "dictation", text: "Long held recording" });
    capture.release();
    expect(run.mock.calls.filter(([args]) => args[0] === "stop")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a latched recording past 30 minutes until the next press", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async (args: string[]) =>
      args[0] === "start"
        ? { session_id: TOKEN }
        : args[0] === "result"
          ? { text: "Long hands-free recording" }
          : {},
    );
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    await capture.accept(id);
    capture.release();
    await vi.advanceTimersByTimeAsync(100);
    capture.press();
    capture.release();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    expect(events).toEqual([{ type: "microphone", captureId: id, pressed: true }]);
    capture.press();
    capture.release();
    await capture.idle();
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start", "stop", "result"]);
    expect(events.at(-1)).toMatchObject({
      type: "dictation",
      captureId: id,
      text: "Long hands-free recording",
    });
    capture.release();
    expect(run.mock.calls.filter(([args]) => args[0] === "stop")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it("expires an unaccepted capture without starting a recorder", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async () => ({ session_id: TOKEN }));
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    await vi.advanceTimersByTimeAsync(60_000);
    await capture.accept(id);
    await capture.idle();
    expect(run).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "microphone", captureId: id, pressed: false });
  } finally {
    vi.useRealTimers();
  }
});

it("cancels a long hands-free recording on disconnect without delivering text", async () => {
  vi.useFakeTimers();
  try {
    const events: DesktopControllerEvent[] = [];
    const run = vi.fn(async (args: string[]) => (args[0] === "start" ? { session_id: TOKEN } : {}));
    const capture = makeControllerDictation(run, (event) => events.push(event));
    capture.setReady(true);
    capture.press();
    const id = events[0]!.captureId;
    await capture.accept(id);
    capture.release();
    capture.press();
    capture.release();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(run.mock.calls.map(([args]) => args[0])).toEqual(["start"]);
    capture.setReady(false);
    await capture.idle();
    expect(run.mock.calls.at(-1)?.[0]).toEqual(["cancel", TOKEN, "--json"]);
    expect(events.some((event) => event.type === "dictation")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
