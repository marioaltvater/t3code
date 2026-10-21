// @effect-diagnostics globalTimers:off -- Recording deadlines belong to the native controller's callback lifecycle.
// @effect-diagnostics cryptoRandomUUID:off -- Capture IDs are generated in the native callback adapter, outside Effect services.
import type { DesktopControllerEvent } from "@t3tools/contracts";

type SessionReply = { session_id?: string; text?: string };
type Capture = {
  id: string;
  held: boolean;
  accepted: boolean;
  cancelled: boolean;
  sessionId: string | null;
  deadline: ReturnType<typeof setTimeout>;
};

export function makeControllerDictation(
  run: (args: string[]) => Promise<SessionReply>,
  emit: (event: DesktopControllerEvent) => void,
) {
  let capture: Capture | null = null;
  let queue = Promise.resolve();
  let ready = false;
  const delivered = new Map<string, string>();

  const enqueue = (current: Capture, operation: () => Promise<void>) => {
    queue = queue.then(operation).catch(async (error: unknown) => {
      if (!current.cancelled && ready)
        emit({
          type: "error",
          captureId: current.id,
          message: error instanceof Error ? error.message : "Controller dictation failed",
        });
      // A failed transcription keeps its tokenized audio/result on disk for recovery.
      current.cancelled = true;
      clearTimeout(current.deadline);
      if (capture === current) capture = null;
      if (current.sessionId) {
        try {
          await run(["cancel", current.sessionId, "--json"]);
        } catch {
          /* Keep the owned token's audio for recovery. */
        }
      }
    });
    return queue;
  };

  const cancel = (id?: string) => {
    const current = capture;
    if (!current || (id !== undefined && current.id !== id)) return queue;
    current.cancelled = true;
    current.held = false;
    clearTimeout(current.deadline);
    if (capture === current) capture = null;
    return enqueue(current, async () => {
      if (current.sessionId) await run(["cancel", current.sessionId, "--json"]);
    });
  };

  const release = () => {
    const current = capture;
    if (!current || !current.held) return;
    current.held = false;
    clearTimeout(current.deadline);
    if (ready) emit({ type: "microphone", captureId: current.id, pressed: false });
    if (!current.accepted) {
      void cancel(current.id);
      return;
    }
    void enqueue(current, async () => {
      if (!current.sessionId || current.cancelled) return;
      await run(["stop", current.sessionId, "--json"]);
      if (current.cancelled) return;
      const result = await run(["result", current.sessionId, "--json"]);
      if (!current.cancelled && ready && typeof result.text === "string") {
        if (delivered.size >= 16) delivered.delete(delivered.keys().next().value!);
        delivered.set(current.id, current.sessionId);
        emit({ type: "dictation", captureId: current.id, text: result.text });
      }
      if (capture === current) capture = null;
    });
  };

  return {
    setReady(value: boolean) {
      ready = value;
      if (!value) void cancel();
    },
    press() {
      if (!ready || capture) return;
      const current: Capture = {
        id: crypto.randomUUID(),
        held: true,
        accepted: false,
        cancelled: false,
        sessionId: null,
        deadline: setTimeout(() => release(), 60_000),
      };
      capture = current;
      emit({ type: "microphone", captureId: current.id, pressed: true });
    },
    release,
    accept(id: string) {
      const current = capture;
      if (!ready || !current || current.id !== id || !current.held || current.accepted)
        return queue;
      current.accepted = true;
      return enqueue(current, async () => {
        const started = await run(["start", "--owner", `t3-k0-${current.id}`, "--json"]);
        if (typeof started.session_id !== "string" || !/^[a-f0-9]{32}$/.test(started.session_id)) {
          throw new Error("Whisper Cursor returned an invalid session token");
        }
        current.sessionId = started.session_id;
      });
    },
    cancel,
    acknowledge(id: string) {
      const token = delivered.get(id);
      if (!token) return Promise.resolve();
      delivered.delete(id);
      const completed = queue.then(async () => {
        await run(["release", token, "--json"]);
      });
      queue = completed.catch(() => {});
      return completed;
    },
    idle: () => queue,
  };
}
