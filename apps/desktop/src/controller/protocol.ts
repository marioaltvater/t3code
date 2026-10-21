import type { KeybindingCommand } from "@t3tools/contracts";

export const K0_REPORT_SIZE = 32;

export const K0_COMMANDS = {
  1: "thread.pinned.1",
  2: "thread.pinned.2",
  3: "thread.pinned.3",
  4: "thread.pinned.4",
  5: "thread.pinned.5",
  6: "thread.pinned.6",
  7: "sidebar.toggle",
  8: "preview.toggle",
  9: "thread.pin",
  10: "composer.decreaseEffort",
  12: "composer.increaseEffort",
  13: "commandPalette.toggle",
  14: "navigation.back",
  15: "navigation.forward",
  16: "terminal.toggle",
  17: "open-settings",
  18: "thread.stop",
  19: "modelPicker.toggle",
  20: "diff.toggle",
  21: "chat.newLocal",
  22: "chat.newWithoutProject",
  23: "composer.submit",
  24: "composer.focus",
  25: "chat.scrollUp",
  26: "chat.scrollDown",
  27: "thread.previous",
  28: "thread.next",
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
    command: control === 11 ? null : K0_COMMANDS[control as keyof typeof K0_COMMANDS],
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
