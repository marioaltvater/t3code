import { describe, expect, it } from "vite-plus/test";
import {
  decodeK0Report,
  decodeK0LightingAck,
  encodeK0Lighting,
  isK0Interface,
} from "./protocol.ts";

function report(control: number, phase = 1) {
  const value = Buffer.alloc(32);
  value.write("T3K0");
  value[4] = 1;
  value[5] = control;
  value[6] = phase;
  value.writeUInt16LE(65_535, 8);
  return value;
}

describe("K0 input boundary", () => {
  it("decodes active slots, microphone release, and physical dial directions independently", () => {
    expect(decodeK0Report(report(6))).toMatchObject({
      command: "thread.active.6",
      sequence: 65_535,
    });
    expect(decodeK0Report(report(11, 0))).toMatchObject({ control: 11, phase: 0, command: null });
    expect(decodeK0Report(report(25, 2))?.command).toBe("chat.nextTurn");
    expect(decodeK0Report(report(26, 2))?.command).toBe("chat.previousTurn");
  });

  it("rejects malformed reports before dispatch", () => {
    for (const [index, value] of [
      [0, 0],
      [4, 2],
      [5, 29],
      [6, 2],
      [7, 2],
      [15, 1],
    ] as const) {
      const invalid = report(1);
      invalid[index] = value;
      expect(decodeK0Report(invalid)).toBeNull();
    }
    expect(decodeK0Report(report(1).subarray(1))).toBeNull();
    expect(decodeK0Report(report(25))).toBeNull();
  });

  it("maps black M1 and M5 to Settings and right-panel visibility toggles", () => {
    expect(decodeK0Report(report(17))?.command).toBe("settings.toggle");
    expect(decodeK0Report(report(20))?.command).toBe("rightPanel.toggle");
  });

  it("maps fn1/fn2 and local Command to the four Chief of Staff positions", () => {
    for (const [control, modifier, command] of [
      [27, 0, "thread.chiefOfStaff.1"],
      [28, 0, "thread.chiefOfStaff.2"],
      [27, 1, "thread.chiefOfStaff.3"],
      [28, 1, "thread.chiefOfStaff.4"],
    ] as const) {
      const value = report(control);
      value[7] = modifier;
      expect(decodeK0Report(value)?.command).toBe(command);
    }
    for (let control = 1; control <= 6; control++) {
      const value = report(control);
      value[7] = 1;
      expect(decodeK0Report(value)?.command).toBe(`thread.active.${control}`);
    }
  });

  it("selects the T3 vendor collection rather than Codex or the maintenance keyboard", () => {
    const descriptor = Buffer.from(
      "0660ff0961a1010962150026ff009520750881020963150026ff00952075089102c0",
      "hex",
    );
    const identity = "HID_ID=0003:0000FEED:0000F3C0\nHID_NAME=K0 T3 Controller\n";
    expect(isK0Interface(identity, descriptor)).toBe(true);
    expect(isK0Interface(identity.replace("F3C0", "8360"), descriptor)).toBe(false);
    expect(isK0Interface(identity.replace("K0 T3 Controller", "Codex Micro"), descriptor)).toBe(
      false,
    );
    expect(isK0Interface(identity, new Uint8Array([5, 1, 9, 6]))).toBe(false);
  });
});

it("accepts only complete, versioned lighting acknowledgements", () => {
  const ack = Buffer.alloc(32);
  ack.write("T3A0");
  ack[4] = 1;
  ack[5] = 255;
  expect(decodeK0LightingAck(ack)).toBe(255);
  expect(decodeK0Report(ack)).toBeNull();
  expect(decodeK0LightingAck(ack.subarray(1))).toBeNull();
  for (const [index, value] of [
    [0, 0],
    [4, 2],
    [6, 1],
    [31, 1],
  ]) {
    const invalid = Buffer.from(ack);
    invalid[index!] = value!;
    expect(decodeK0LightingAck(invalid)).toBeNull();
  }
});

it("encodes an atomic 26 LED transaction with hidraw's zero report ID and blank padding", () => {
  const colors = Array.from({ length: 26 }, (_, index) => 0x123400 + index);
  const pages = encodeK0Lighting(colors, 257);
  expect(pages).toHaveLength(4);
  for (const [page, report] of pages.entries()) {
    expect([...report.subarray(0, 9)]).toEqual([0, 84, 51, 76, 48, 1, page, 1, 0]);
    expect(report.length).toBe(33);
  }
  expect([...pages[0]!.subarray(9, 12)]).toEqual([0x12, 0x34, 0]);
  expect([...pages[3]!.subarray(9, 15)]).toEqual([0x12, 0x34, 24, 0x12, 0x34, 25]);
  expect(pages[3]!.subarray(15).every((byte) => byte === 0)).toBe(true);
  expect(() => encodeK0Lighting(colors.slice(1), 0)).toThrow();
  for (const invalid of [-1, 0x1000000, 0.5, NaN]) {
    expect(() => encodeK0Lighting([invalid, ...colors.slice(1)], 0)).toThrow();
  }
});
