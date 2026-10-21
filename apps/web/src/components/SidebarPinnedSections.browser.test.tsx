import { expect, it } from "vite-plus/test";
import "../index.css";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { dismissContextMenu } from "../contextMenuFallback";
import { PinnedSectionHeader } from "./SidebarPinnedSections";

it.each([
  { label: "Pinned", section: null },
  {
    label: "Research",
    section: { id: "research", name: "Research", threadKeys: [], collapsed: false },
  },
])(
  "shows $label actions instantly and keeps them visible until the menu closes",
  async ({ label, section }) => {
    await using screen = await render(
      <div style={{ width: 260 }}>
        <PinnedSectionHeader section={section} count={2} />
        <button data-testid="outside" style={{ marginTop: 100 }}>
          Outside
        </button>
      </div>,
    );
    using _menu = { [Symbol.dispose]: dismissContextMenu };
    const trigger = screen.container.querySelector<HTMLButtonElement>(
      `button[aria-label="Manage ${label}"]`,
    )!;
    const action = trigger.parentElement!;
    const header = screen.container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const outside = screen.container.querySelector<HTMLButtonElement>('[data-testid="outside"]')!;
    await userEvent.hover(outside);
    const headerWidth = header.getBoundingClientRect().width;
    expect(getComputedStyle(action).opacity).toBe("0");

    await userEvent.hover(header);
    expect(getComputedStyle(action).opacity).toBe("1");
    expect(header.getBoundingClientRect().width).toBe(headerWidth);
    expect(action.getAnimations()).toHaveLength(0);
    await userEvent.click(trigger);
    await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
    const menuItem = document.querySelector<HTMLButtonElement>('[data-level="0"] button')!;
    menuItem.focus();
    await userEvent.hover(outside);
    expect(getComputedStyle(action).opacity).toBe("1");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(outside);
    expect(getComputedStyle(action).opacity).toBe("0");
  },
);
