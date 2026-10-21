// @effect-diagnostics nodeBuiltinImport:off -- Linux hidraw is a local native device boundary; no remote server or native Node addon is involved.
// @effect-diagnostics globalTimers:off -- Nonblocking hidraw reads and reconnect checks run outside the Effect fiber pool.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeUtil from "node:util";
import type { DesktopControllerEvent } from "@t3tools/contracts";
import { makeControllerDictation } from "./dictation.ts";
import {
  decodeK0Report,
  decodeK0LightingAck,
  encodeK0Lighting,
  isK0Interface,
  K0_LED_COUNT,
  K0_REPORT_SIZE,
} from "./protocol.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

export function startLinuxK0Controller(options: {
  command: (command: string) => void;
  event: (event: DesktopControllerEvent) => void;
  warning: (message: string) => void;
}) {
  let ready = false;
  let requestedReady = false;
  let closed = false;
  let device: number | null = null;
  let previousSequence: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWarning = "";
  let lighting: ReadonlyArray<number> | null = null;
  let lightingDirty = false;
  let lightingSequence = 0;
  let lightingSentAt = 0;
  let blackoutPending = false;
  let lightingSentSequence: number | null = null;
  let lightingVerifiedAt: number | null = null;
  let lightingStartedAt: number | null = null;
  const dark = Array<number>(K0_LED_COUNT).fill(0);
  const warn = (message: string) => {
    if (message !== lastWarning) options.warning(message);
    lastWarning = message;
  };
  const dictation = makeControllerDictation(async (args) => {
    const executable =
      process.env.T3CODE_WHISPER_CURSOR ??
      NodePath.join(NodeOS.homedir(), ".local/bin/whisper-cursor");
    const { stdout } = await execFileAsync(executable, ["session", ...args], {
      timeout: args[0] === "result" ? 180_000 : 15_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    const result: unknown = JSON.parse(stdout);
    if (typeof result !== "object" || result === null)
      throw new Error("Invalid Whisper Cursor response");
    const value = result as { session_id?: unknown; text?: unknown; error?: unknown };
    if (typeof value.error === "string") throw new Error(value.error);
    return {
      ...(typeof value.session_id === "string" ? { session_id: value.session_id } : {}),
      ...(typeof value.text === "string" ? { text: value.text } : {}),
    };
  }, options.event);

  const disconnect = () => {
    if (device !== null) {
      try {
        NodeFS.closeSync(device);
      } catch {
        /* The device may have disappeared. */
      }
    }
    device = null;
    lightingDirty = true;
    previousSequence = null;
    lightingSentSequence = null;
    lightingVerifiedAt = null;
    lightingStartedAt = null;
    ready = false;
    dictation.setReady(false);
  };

  const discover = () => {
    for (const name of NodeFS.readdirSync("/sys/class/hidraw")) {
      if (!/^hidraw\d+$/.test(name)) continue;
      const directory = NodePath.join("/sys/class/hidraw", name, "device");
      try {
        if (
          !isK0Interface(
            NodeFS.readFileSync(NodePath.join(directory, "uevent"), "utf8"),
            NodeFS.readFileSync(NodePath.join(directory, "report_descriptor")),
          )
        )
          continue;
        device = NodeFS.openSync(
          NodePath.join("/dev", name),
          NodeFS.constants.O_RDWR | NodeFS.constants.O_NONBLOCK,
        );
        lastWarning = "";
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EACCES") {
          warn(
            "K0 T3 Controller needs its active-seat hidraw udev rule; reconnect after installing it.",
          );
        }
      }
    }
  };

  const writeLighting = (colors: ReadonlyArray<number>) => {
    if (device === null) return false;
    try {
      for (const report of encodeK0Lighting(colors, lightingSequence++)) {
        if (NodeFS.writeSync(device, report) !== report.length) {
          throw new Error("Incomplete K0 lighting report");
        }
      }
      lightingSentSequence = (lightingSequence - 1) & 0xff;
      lightingStartedAt ??= NodePerfHooks.performance.now();
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EAGAIN" && code !== "EWOULDBLOCK") {
        disconnect();
        warn(`K0 lighting: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  };

  const report = Buffer.alloc(K0_REPORT_SIZE);
  const readReports = () => {
    if (device === null) return;
    try {
      for (let count = 0; count < 32; count++) {
        const length = NodeFS.readSync(device, report, 0, report.length, null);
        if (length === 0) {
          disconnect();
          return;
        }
        const ack = decodeK0LightingAck(report.subarray(0, length));
        if (ack !== null) {
          if (ack === lightingSentSequence) {
            lightingVerifiedAt = NodePerfHooks.performance.now();
          }
          continue;
        }
        const event = decodeK0Report(report.subarray(0, length));
        if (!event || event.sequence === previousSequence) continue;
        previousSequence = event.sequence;
        if (!ready) continue;
        if (event.control === 11) {
          if (event.phase === 1) dictation.press();
          else dictation.release();
        } else if (event.phase !== 0 && event.command) options.command(event.command);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        // Readiness starts at an empty kernel queue, including reports that
        // arrived between the last unavailable poll and the ready IPC.
        if (requestedReady && !ready) {
          ready = true;
          dictation.setReady(true);
        }
      } else {
        disconnect();
        if (code !== "ENOENT" && code !== "ENODEV" && code !== "EIO") {
          warn(`K0 controller: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  };
  const poll = () => {
    if (closed) return;
    try {
      if (device === null) discover();
      readReports();
      if (blackoutPending && writeLighting(dark)) blackoutPending = false;
      if (
        ready &&
        lighting &&
        (lightingDirty || NodePerfHooks.performance.now() - lightingSentAt >= 1_000)
      ) {
        if (writeLighting(lighting)) {
          lightingDirty = false;
          lightingSentAt = NodePerfHooks.performance.now();
        }
      }
      if (
        ready &&
        lighting &&
        lightingStartedAt !== null &&
        NodePerfHooks.performance.now() - (lightingVerifiedAt ?? lightingStartedAt) > 5_000
      )
        warn(
          "K0 has not acknowledged its LED state. Check that the T3 lighting firmware is installed.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warn(`K0 controller discovery: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    timer = setTimeout(poll, device === null ? 1_000 : 12);
    timer.unref();
  };

  // Abstract Linux sockets are released by the kernel on crash. This prevents
  // two T3 installations from reading the same reports, without stale lockfiles.
  const ownership = NodeNet.createServer((socket) => socket.destroy());
  const claim = () => {
    if (!closed) ownership.listen(`\0t3-k0-controller-${process.getuid?.() ?? "user"}`);
  };
  ownership.on("listening", poll);
  ownership.on("error", (error: NodeJS.ErrnoException) => {
    if (closed) return;
    warn(
      error.code === "EADDRINUSE"
        ? "Another T3 instance owns the K0 controller. Waiting for it to release the device."
        : `K0 controller ownership: ${error.message}`,
    );
    timer = setTimeout(claim, 1_000);
    timer.unref();
  });
  claim();

  return {
    setReady(value: boolean) {
      if (!value) {
        blackoutPending = !writeLighting(dark);
        lighting = null;
        lightingStartedAt = null;
        lightingVerifiedAt = null;
      }
      requestedReady = value;
      ready = false;
      dictation.setReady(false);
      if (value) readReports();
    },
    setLighting(colors: ReadonlyArray<number>) {
      // Copy at the boundary: later renderer mutations cannot change a snapshot.
      encodeK0Lighting(colors, 0);
      lighting = [...colors];
      lightingDirty = true;
    },
    acceptDictation: dictation.accept,
    cancelDictation: dictation.cancel,
    acknowledgeDictation: dictation.acknowledge,
    async close() {
      closed = true;
      requestedReady = false;
      ready = false;
      clearTimeout(timer);
      writeLighting(dark);
      disconnect();
      ownership.close();
      await dictation.idle();
    },
  };
}
