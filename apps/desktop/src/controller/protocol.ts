import type { KeybindingCommand } from "@t3tools/contracts";

export const K0_REPORT_SIZE = 32;
export const K0_LED_COUNT = 26;

export function decodeK0LightingAck(report: Uint8Array) {
  if (
    report.length !== K0_REPORT_SIZE ||
    report[0] !== 0x54 ||
    report[1] !== 0x33 ||
    report[2] !== 0x41 ||
    report[3] !== 0x30 ||
    report[4] !== 1 ||
    report.subarray(6).some((byte) => byte !== 0)
  )
    return null;
  return report[5]!;
}

export function encodeK0Lighting(colors: ReadonlyArray<number>, sequence: number) {
  if (
    colors.length !== K0_LED_COUNT ||
    colors.some((color) => !Number.isInteger(color) || color < 0 || color > 0xffffff)
  )
    throw new Error("K0 lighting requires 26 RGB colors");
  return Array.from({ length: 4 }, (_, page) => {
    // hidraw writes require the leading report ID even for unnumbered reports.
    const report = Buffer.alloc(K0_REPORT_SIZE + 1);
    report.write("T3L0", 1);
    report[5] = 1;
    report[6] = page;
    report[7] = sequence & 0xff;
    for (let index = 0; index < 8 && page * 8 + index < colors.length; index++) {
      const color = colors[page * 8 + index]!;
      report[9 + index * 3] = color >>> 16;
      report[10 + index * 3] = (color >>> 8) & 0xff;
      report[11 + index * 3] = color & 0xff;
    }
    return report;
  });
}

export const K0_COMMANDS = {
  1: "thread.active.1",
  2: "thread.active.2",
  3: "thread.active.3",
  4: "thread.active.4",
  5: "thread.active.5",
  6: "thread.active.6",
  7: "sidebar.toggle",
  8: "preview.toggle",
  9: "thread.pin",
  10: "composer.decreaseEffort",
  12: "composer.increaseEffort",
  13: "commandPalette.toggle",
  14: "navigation.back",
  15: "navigation.forward",
  16: "terminal.toggle",
  17: "settings.toggle",
  18: "thread.stop",
  19: "modelPicker.toggle",
  20: "rightPanel.toggle",
  21: "chat.newLocal",
  22: "chat.newWithoutProject",
  23: "composer.submit",
  24: "composer.focus",
  // The flashed encoder map emits 25 clockwise and 26 counterclockwise.
  25: "chat.nextTurn",
  26: "chat.previousTurn",
  27: "thread.chiefOfStaff.1",
  28: "thread.chiefOfStaff.2",
  30: "threadPanel.toggle",
} as const satisfies Record<number, KeybindingCommand>;

export function decodeK0Report(report: Uint8Array) {
  if (
    report.length !== K0_REPORT_SIZE ||
    report[0] !== 0x54 ||
    report[1] !== 0x33 ||
    report[2] !== 0x4b ||
    report[3] !== 0x30 ||
    report[4] !== 1 ||
    (report[7]! & ~1) !== 0 ||
    report.subarray(10).some((byte) => byte !== 0)
  )
    return null;
  const control = report[5]!;
  const phase = report[6]!;
  if (control !== 11 && !(control in K0_COMMANDS)) return null;
  const encoder = control === 25 || control === 26;
  if (encoder ? phase !== 2 : phase !== 0 && phase !== 1) return null;
  return {
    control,
    phase,
    sequence: report[8]! | (report[9]! << 8),
    command:
      control === 11
        ? null
        : (control === 27 || control === 28) && report[7] === 1
          ? control === 27
            ? "thread.chiefOfStaff.3"
            : "thread.chiefOfStaff.4"
          : K0_COMMANDS[control as keyof typeof K0_COMMANDS],
  };
}

export function isK0Interface(uevent: string, descriptor: Uint8Array) {
  const fields = new Map(
    uevent
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  if (fields.get("HID_ID")?.toUpperCase() !== "0003:0000FEED:0000F3C0") return false;
  if (!fields.get("HID_NAME")?.endsWith("K0 T3 Controller")) return false;
  const bytes = Buffer.from(descriptor);
  // This firmware has one fixed unnumbered QMK vendor report descriptor.
  // Matching it exactly excludes the composite maintenance keyboard and avoids
  // mistaking data bytes for HID report-ID items.
  return bytes.equals(
    Buffer.from("0660ff0961a1010962150026ff009520750881020963150026ff00952075089102c0", "hex"),
  );
}
