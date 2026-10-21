import { expect, it } from "vite-plus/test";
import "../index.css";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { useUiStateStore } from "../uiStateStore";
import { dismissContextMenu } from "../contextMenuFallback";
import { SidebarThreadSectionHeader } from "./SidebarPinnedSections";

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
        <SidebarThreadSectionHeader section={section} count={2} />
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

it.each([
  { label: "Pinned", shelf: "pinned", section: null, key: "pinned", compact: false },
  { label: "Active", shelf: "active", section: null, key: "active", compact: false },
  { label: "Working", shelf: "working", section: null, key: "working", compact: false },
  { label: "Snoozed", shelf: "snoozed", section: null, key: "snoozed", compact: true },
  { label: "Settled", shelf: "settled", section: null, key: "settled", compact: true },
  {
    label: "Research",
    shelf: "pinned",
    section: { id: "research", name: "Research", threadKeys: [], collapsed: false },
    key: "pinned-section:research",
    compact: false,
  },
] as const)(
  "toggles compact threads in $label without changing another section",
  async ({ label, shelf, section, key, compact }) => {
    const previous = useUiStateStore.getState().sidebarCompactSections;
    using _state = {
      [Symbol.dispose]: () => useUiStateStore.setState({ sidebarCompactSections: previous }),
    };
    useUiStateStore.setState({ sidebarCompactSections: { snoozed: true, settled: true } });
    await using screen = await render(
      <SidebarThreadSectionHeader
        shelf={shelf}
        section={section ? { ...section, threadKeys: [...section.threadKeys] } : null}
        count={2}
      />,
    );
    using _menu = { [Symbol.dispose]: dismissContextMenu };
    const trigger = screen.container.querySelector<HTMLButtonElement>(
      `button[aria-label="Manage ${label}"]`,
    )!;
    for (const expected of [compact, !compact]) {
      await userEvent.hover(trigger.parentElement!.parentElement!);
      await userEvent.click(trigger);
      await userEvent.hover(page.getByText("Display", { exact: true }));
      const defaultItem = page.getByRole("menuitemradio", { name: "Default", exact: true });
      const compactItem = page.getByRole("menuitemradio", { name: "Compact", exact: true });
      await expect.element(compactItem).toHaveAttribute("aria-checked", String(expected));
      await expect.element(defaultItem).toHaveAttribute("aria-checked", String(!expected));
      await userEvent.click(expected ? defaultItem : compactItem);
      await expect
        .poll(() => useUiStateStore.getState().sidebarCompactSections[key])
        .toBe(!expected);
      expect(
        useUiStateStore.getState().sidebarCompactSections[
          key === "settled" ? "snoozed" : "settled"
        ],
      ).toBe(true);
    }
  },
);
