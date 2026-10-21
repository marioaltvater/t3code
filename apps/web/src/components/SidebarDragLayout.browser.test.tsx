import { DndContext } from "@dnd-kit/core";
import { useRef } from "react";
import { expect, it } from "vite-plus/test";
import { render } from "../../test/render";
import { SidebarDragLayout } from "./SidebarDragLayout";

function Layout({ dragging }: { dragging: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <DndContext>
      <SidebarDragLayout layout={{ key: String(dragging), dragging }} listRef={listRef} />
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
