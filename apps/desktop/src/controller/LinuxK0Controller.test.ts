import { expect, it, vi } from "vite-plus/test";

const device = vi.hoisted(() => ({
  reports: [] as Uint8Array[],
  listeners: new Map<string, () => void>(),
  available: true,
  writes: [] as Uint8Array[],
  writeBusy: false,
}));

vi.mock("node:perf_hooks", () => ({
  performance: { now: () => vi.getMockedSystemTime()?.getTime() ?? 0 },
}));

vi.mock("node:fs", () => ({
  constants: { O_RDWR: 2, O_NONBLOCK: 2048 },
  readdirSync: () => (device.available ? ["hidraw0"] : []),
  readFileSync: (path: string) =>
    path.endsWith("uevent")
      ? "HID_ID=0003:0000FEED:0000F3C0\nHID_NAME=Mario K0 T3 Controller\n"
      : Buffer.from("0660ff0961a1010962150026ff009520750881020963150026ff00952075089102c0", "hex"),
  openSync: () => 10,
  closeSync: () => {},
  writeSync: (_fd: number, report: Uint8Array) => {
    if (device.writeBusy) throw Object.assign(new Error("Busy"), { code: "EAGAIN" });
    device.writes.push(Uint8Array.from(report));
    return report.length;
  },
  readSync: (_fd: number, buffer: Uint8Array) => {
    if (!device.available) throw Object.assign(new Error("Unplugged"), { code: "ENODEV" });
    const report = device.reports.shift();
    if (!report) throw Object.assign(new Error("Empty"), { code: "EAGAIN" });
    buffer.set(report);
    return report.length;
  },
}));

vi.mock("node:net", () => ({
  createServer: () => ({
    on(name: string, listener: () => void) {
      device.listeners.set(name, listener);
    },
    listen() {
      device.listeners.get("listening")?.();
    },
    close() {},
  }),
}));

import { startLinuxK0Controller } from "./LinuxK0Controller.ts";

function setup() {
  device.reports = [];
  device.listeners.clear();
  device.available = true;
  device.writes = [];
  device.writeBusy = false;
  vi.useFakeTimers();
  const command = vi.fn();
  const controller = startLinuxK0Controller({ command, event: vi.fn(), warning: vi.fn() });
  return { controller, command };
}

function submit(sequence: number) {
  const report = Buffer.alloc(32);
  report.write("T3K0");
  report[4] = 1;
  report[5] = 23;
  report[6] = 1;
  report.writeUInt16LE(sequence, 8);
  return report;
}

it("discards a submit queued between the last unavailable poll and ready IPC", async () => {
  const { controller, command } = setup();
  try {
    device.reports.push(submit(1));
    controller.setReady(true);
    await vi.advanceTimersByTimeAsync(12);
    expect(command).not.toHaveBeenCalled();
    device.reports.push(submit(2));
    await vi.advanceTimersByTimeAsync(12);
    expect(command).toHaveBeenCalledExactlyOnceWith("composer.submit");
  } finally {
    await controller.close();
    vi.useRealTimers();
  }
});

it("refreshes current lighting while ready, retries busy writes, and blanks on renderer loss", async () => {
  const { controller } = setup();
  try {
    const colors = Array<number>(26).fill(0x123456);
    controller.setLighting(colors);
    colors[0] = 0;
    await vi.advanceTimersByTimeAsync(12);
    expect(device.writes).toHaveLength(0);
    controller.setReady(true);
    device.writeBusy = true;
    await vi.advanceTimersByTimeAsync(12);
    expect(device.writes).toHaveLength(0);
    device.writeBusy = false;
    await vi.advanceTimersByTimeAsync(12);
    expect(device.writes).toHaveLength(4);
    expect([...device.writes[0]!.subarray(9, 12)]).toEqual([0x12, 0x34, 0x56]);
    await vi.advanceTimersByTimeAsync(1_008);
    expect(device.writes).toHaveLength(8);
    controller.setReady(false);
    expect(device.writes).toHaveLength(12);
    expect(device.writes.slice(8).every((report) => report.subarray(9).every((x) => x === 0))).toBe(
      true,
    );
    controller.setReady(true);
    await vi.advanceTimersByTimeAsync(1_008);
    expect(device.writes).toHaveLength(12);
  } finally {
    await controller.close();
    vi.useRealTimers();
  }
});

it("retries an unavailable renderer's blackout without resuming the previous state", async () => {
  const { controller } = setup();
  try {
    controller.setReady(true);
    controller.setLighting(Array<number>(26).fill(0x0169cc));
    await vi.advanceTimersByTimeAsync(12);
    expect(device.writes).toHaveLength(4);
    device.writeBusy = true;
    controller.setReady(false);
    await vi.advanceTimersByTimeAsync(12);
    expect(device.writes).toHaveLength(4);
    device.writeBusy = false;
    await vi.advanceTimersByTimeAsync(12);
    expect(device.writes).toHaveLength(8);
    expect(device.writes.slice(4).every((report) => report.subarray(9).every((x) => x === 0))).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(1_008);
    expect(device.writes).toHaveLength(8);
  } finally {
    await controller.close();
    vi.useRealTimers();
  }
});

it("keeps a backlog larger than one poll unavailable until it reaches an empty queue", async () => {
  const { controller, command } = setup();
  try {
    for (let sequence = 0; sequence < 80; sequence++) device.reports.push(submit(sequence));
    controller.setReady(true);
    await vi.advanceTimersByTimeAsync(36);
    expect(command).not.toHaveBeenCalled();
    device.reports.push(submit(81));
    await vi.advanceTimersByTimeAsync(12);
    expect(command).toHaveBeenCalledExactlyOnceWith("composer.submit");
  } finally {
    await controller.close();
    vi.useRealTimers();
  }
});

it("reestablishes the empty queue boundary after unplug and reconnect", async () => {
  const { controller, command } = setup();
  try {
    controller.setReady(true);
    device.available = false;
    await vi.advanceTimersByTimeAsync(12);
    device.available = true;
    device.reports.push(submit(1));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(command).not.toHaveBeenCalled();
    device.reports.push(submit(2));
    await vi.advanceTimersByTimeAsync(12);
    expect(command).toHaveBeenCalledExactlyOnceWith("composer.submit");
  } finally {
    await controller.close();
    vi.useRealTimers();
  }
});
