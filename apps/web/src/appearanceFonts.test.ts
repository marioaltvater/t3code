import { expect, it } from "vite-plus/test";
import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
  resolveDefaultFamilyLabel,
} from "./appearanceFonts";

it("identifies the bundled interface font before browser font discovery", () => {
  expect(resolveDefaultFamilyLabel(DEFAULT_SANS_FONT_STACK)).toBe("Geist");
  expect(resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK)).toBe("Geist Mono");
});
