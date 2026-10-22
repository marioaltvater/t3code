import { DndContext } from "@dnd-kit/core";
import { useRef } from "react";
import { expect, it } from "vite-plus/test";
import "../index.css";
import { render } from "../../test/render";
import { SidebarDragLayout } from "./SidebarDragLayout";
import { SidebarDropBox } from "./SidebarDropTargets";
import { CollapsibleSectionHeader } from "./ui/collapsible-section-header";

function PinnedLayout({ dragging, named }: { dragging: boolean; named: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  const label = named ? "Research" : "Pinned";
  return (
    <DndContext>
      <SidebarDragLayout layout={{ key: String(dragging), dragging }} listRef={listRef} />
      <ul ref={listRef} style={{ position: "relative", width: 260, padding: 0, margin: 0 }}>
        <li
          data-sidebar-marker="pinned-header"
          style={{ position: "relative", height: dragging ? 96 : 32 }}
        >
          {dragging ? (
            <SidebarDropBox
              destination={{
                id: "sidebar-destination:pinned",
                label,
                count: 2,
                disabled: false,
              }}
              align="start"
            />
          ) : (
            <CollapsibleSectionHeader variant="sidebar" expanded>
              {label} (2)
            </CollapsibleSectionHeader>
          )}
        </li>
      </ul>
    </DndContext>
  );
}

it.each([false, true])(
  "keeps a pinned target and title horizontally anchored through drag transitions (named=%s)",
  async (named) => {
    await using screen = await render(<PinnedLayout dragging={false} named={named} />);
    const title = screen.container.querySelector("button[aria-expanded] span")!;
    const left = title.getBoundingClientRect().left;
    const width = screen.container.querySelector("li")!.getBoundingClientRect().width;
    await screen.rerender(<PinnedLayout dragging named={named} />);
    const box = screen.container.querySelector<HTMLElement>(
      '[data-testid="sidebar-destination:pinned"]',
    )!;
    const [animation] = box.getAnimations();
    animation!.pause();
    for (const time of [0, 90, 180]) {
      animation!.currentTime = time;
      expect(box.getBoundingClientRect().width).toBe(width);
      expect(
        Math.abs(box.firstElementChild!.getBoundingClientRect().left - left),
      ).toBeLessThanOrEqual(1);
    }
    await screen.rerender(<PinnedLayout dragging={false} named={named} />);
    const restoredTitle = screen.container.querySelector("button[aria-expanded] span")!;
    expect(restoredTitle.getBoundingClientRect().left).toBe(left);
  },
);

function Layout({ dragging, revision = 0 }: { dragging: boolean; revision?: number }) {
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <DndContext>
      <SidebarDragLayout layout={{ key: `${dragging}:${revision}`, dragging }} listRef={listRef} />
      <ul ref={listRef} style={{ position: "relative", padding: 0, margin: 0 }}>
        <li data-sidebar-marker="pinned-header" style={{ height: dragging ? 96 : 32 }}>
          {dragging ? (
            <div
              data-testid="sidebar-destination:pinned"
              style={{ height: 96, border: "1px dashed gray", boxSizing: "border-box" }}
            >
              Pinned (2)
            </div>
          ) : (
            <div style={{ height: 32 }}>Pinned (2)</div>
          )}
        </li>
        <li
          data-sidebar-marker="source-header"
          data-sidebar-source={dragging || undefined}
          style={{ height: 32 }}
        >
          <div style={{ height: 32 }}>Active</div>
        </li>
        <li data-thread-item="source" style={{ height: 82 }}>
          Source
        </li>
      </ul>
    </DndContext>
  );
}

it("collapses and fades outgoing destinations before removing them", async () => {
  await using screen = await render(<Layout dragging={false} />);
  await screen.rerender(<Layout dragging />);
  const box = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  for (const animation of box.getAnimations()) animation.finish();
  await screen.rerender(<Layout dragging={false} />);
  const exit = screen.container.querySelector<HTMLElement>('[aria-hidden="true"]')!;
  expect(exit).not.toBeNull();
  expect(exit.inert).toBe(true);
  expect(exit.hasAttribute("data-testid")).toBe(false);
  const [animation] = exit.getAnimations();
  animation!.pause();
  animation!.currentTime = 0;
  const start = exit.getBoundingClientRect().height;
  animation!.currentTime = 75;
  expect(exit.getBoundingClientRect().height).toBeLessThan(start);
  expect(exit.getBoundingClientRect().height).toBeGreaterThan(32);
  expect(Number(getComputedStyle(exit).opacity)).toBeGreaterThan(0);
  expect(Number(getComputedStyle(exit).opacity)).toBeLessThan(1);
  await new Promise<void>((resolve) => {
    animation!.addEventListener("finish", () => resolve(), { once: true });
    animation!.finish();
  });
  expect(exit.isConnected).toBe(false);
  expect(
    screen.container.querySelector('[data-thread-item="source"]')!.getAnimations(),
  ).toHaveLength(0);
});

it("keeps the source title out of destination animations and leaves stationary targets alone", async () => {
  await using screen = await render(<Layout dragging={false} />);
  await screen.rerender(<Layout dragging />);
  const source = screen.container.querySelector<HTMLElement>(
    '[data-sidebar-marker="source-header"]',
  )!;
  const destination = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  expect(source.getAnimations({ subtree: true })).toHaveLength(0);
  for (const animation of destination.getAnimations()) animation.finish();
  await screen.rerender(<Layout dragging revision={1} />);
  expect(source.getAnimations({ subtree: true })).toHaveLength(0);
  expect(destination.getAnimations()).toHaveLength(0);
  await screen.rerender(<Layout dragging={false} />);
  expect(source.getAnimations({ subtree: true })).toHaveLength(0);
});

it("reverses an unfinished exit without leaving duplicate destination chrome", async () => {
  await using screen = await render(<Layout dragging={false} />);
  await screen.rerender(<Layout dragging />);
  await screen.rerender(<Layout dragging={false} />);
  const exit = screen.container.querySelector<HTMLElement>('[aria-hidden="true"]')!;
  const [animation] = exit.getAnimations();
  animation!.pause();
  animation!.currentTime = 60;
  const halfway = exit.getBoundingClientRect().height;
  await screen.rerender(<Layout dragging />);
  const box = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  const [returning] = box.getAnimations();
  returning!.pause();
  returning!.currentTime = 0;
  expect(Math.abs(box.getBoundingClientRect().height - halfway)).toBeLessThan(1);
  expect(exit.isConnected).toBe(false);
  expect(
    screen.container.querySelectorAll('[data-testid="sidebar-destination:pinned"]'),
  ).toHaveLength(1);
});
