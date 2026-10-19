import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { DraftProjectName } from "./DraftProjectName";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("DraftProjectName", () => {
  it.each([
    [14, 1],
    [30, 1],
    [14, 1.44],
    [30, 1.44],
    [33.75, 1.5],
  ])("keeps a fitting name at %spx and %s scale", async (fontSize, zoom) => {
    await act(() =>
      root.render(
        <div
          style={{
            fontFamily: "Geist",
            fontWeight: 500,
            letterSpacing: "-0.025em",
            fontSize,
            zoom,
            // Exercise scaled font rasterization in unscaled layout coordinates.
            transform: `scale(${1 / zoom})`,
            width: 400,
          }}
        >
          <DraftProjectName value="Loomia" />
        </div>,
      ),
    );
    await act(async () => {
      await document.fonts.ready;
    });
    await expect
      .poll(() => container.querySelector('[aria-label="Loomia"]')?.textContent)
      .toBe("Loomia");
  });

  it("fits long names and restores them when the available space grows", async () => {
    const name = "ExampleCompany-CustomerPortal-App";
    container.style.cssText = "width: 100px; font: 14px Geist; zoom: 1.5";
    await act(() => root.render(<DraftProjectName value={name} />));
    await act(async () => {
      await document.fonts.ready;
    });
    const label = () => container.querySelector<HTMLSpanElement>("[aria-label]")!;
    await expect.poll(() => label().textContent).toContain("…");
    const text = document.createRange();
    text.selectNodeContents(label());
    expect(text.getBoundingClientRect().width).toBeLessThanOrEqual(
      // Range bounds can round out to the next rendered pixel.
      label().getBoundingClientRect().width + 1,
    );
    expect(label().textContent).toMatch(/App$/);
    await act(async () => {
      container.style.width = "600px";
      await expect.poll(() => label().textContent).toBe(name);
    });
  });
});
