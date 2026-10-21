import { expect, it, vi } from "vite-plus/test";

const device = vi.hoisted(() => ({
  reports: [] as Uint8Array[],
  listeners: new Map<string, () => void>(),
  available: true,
}));

vi.mock("node:fs", () => ({
  constants: { O_RDONLY: 0, O_NONBLOCK: 2048 },
  readdirSync: () => (device.available ? ["hidraw0"] : []),
  readFileSync: (path: string) =>
    path.endsWith("uevent")
      ? "HID_ID=0003:0000FEED:0000F3C0\nHID_NAME=Mario K0 T3 Controller\n"
      : Buffer.from("0660ff0961a1010962150026ff009520750881020963150026ff00952075089102c0", "hex"),
  openSync: () => 10,
  closeSync: () => {},
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
