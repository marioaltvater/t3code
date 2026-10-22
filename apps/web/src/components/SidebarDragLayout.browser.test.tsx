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
              key="destination"
              data-testid="sidebar-destination:pinned"
              style={{ height: 96, border: "1px dashed gray", boxSizing: "border-box" }}
            >
              Pinned ({2 + revision})
            </div>
          ) : (
            <div key="header" style={{ height: 32 }}>
              Pinned ({2 + revision})
            </div>
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

it("removes accepted destination chrome before restoring the updated header", async () => {
  await using screen = await render(<Layout dragging={false} />);
  await screen.rerender(<Layout dragging />);
  const box = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  box.setAttribute("data-drop-accepted", "true");
  for (const animation of box.getAnimations()) animation.finish();
  await screen.rerender(<Layout dragging={false} revision={1} />);
  expect(screen.container.querySelector('[data-testid="sidebar-destination:pinned"]')).toBeNull();
  expect(screen.container.querySelector('[aria-hidden="true"]')).toBeNull();
  expect(screen.container.querySelector("[data-drop-accepted]")).toBeNull();
  expect(screen.container.textContent).toContain("Pinned (3)");
  expect(screen.container.textContent).not.toContain("Pinned (2)");
  const header = screen.container.querySelector<HTMLElement>(
    '[data-sidebar-marker="pinned-header"]',
  )!;
  // Release travel is owned by list motion; destination chrome has no second clock.
  expect(header.getAnimations({ subtree: true })).toHaveLength(0);
  expect(
    screen.container.querySelector('[data-thread-item="source"]')!.getAnimations(),
  ).toHaveLength(0);
});

it("moves the source title with expanding targets and leaves stationary targets alone", async () => {
  await using screen = await render(<Layout dragging={false} />);
  await screen.rerender(<Layout dragging />);
  const source = screen.container.querySelector<HTMLElement>(
    '[data-sidebar-marker="source-header"]',
  )!;
  const destination = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  expect(source.getAnimations({ subtree: true })).toHaveLength(1);
  for (const animation of source.getAnimations({ subtree: true })) animation.finish();
  for (const animation of destination.getAnimations()) animation.finish();
  await screen.rerender(<Layout dragging revision={1} />);
  expect(source.getAnimations({ subtree: true })).toHaveLength(0);
  expect(destination.getAnimations()).toHaveLength(0);
  await screen.rerender(<Layout dragging={false} />);
  expect(source.getAnimations({ subtree: true })).toHaveLength(0);
});

function SourceBoundaryLayout({ expanded }: { expanded: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  return (
    <DndContext>
      <SidebarDragLayout layout={{ key: String(expanded), dragging: true }} listRef={listRef} />
      <ul ref={listRef} style={{ position: "relative", width: 260, padding: 0, margin: 0 }}>
        <li data-sidebar-marker="named" style={{ height: expanded ? 96 : 36 }}>
          <div data-testid="sidebar-destination:named" style={{ height: "100%" }}>
            Chief of Staff
          </div>
        </li>
        <li data-sidebar-marker="active" data-sidebar-source style={{ height: 32 }}>
          <div data-testid="source-title" style={{ height: 32 }}>
            Active
          </div>
        </li>
        <li data-thread-item="held" style={{ height: 82 }}>
          <div role="button" style={{ position: "fixed", top: 280, height: 78 }}>
            Held
          </div>
        </li>
      </ul>
    </DndContext>
  );
}

it("keeps Active below the named destination throughout collapse and reversal", async () => {
  await using screen = await render(<SourceBoundaryLayout expanded />);
  const box = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:named"]',
  )!;
  const title = screen.container.querySelector<HTMLElement>('[data-testid="source-title"]')!;
  const held = screen.container.querySelector<HTMLElement>('[role="button"]')!;
  const animations = () => [...box.getAnimations(), ...title.getAnimations()];
  for (const animation of animations()) animation.finish();
  await screen.rerender(<SourceBoundaryLayout expanded={false} />);
  const collapsing = animations();
  for (const animation of collapsing) animation.pause();
  for (const time of [0, 45, 90]) {
    for (const animation of collapsing) animation.currentTime = time;
    expect(
      Math.abs(title.getBoundingClientRect().top - box.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(1);
    expect(held.getBoundingClientRect().top).toBe(280);
  }
  const beforeReversal = title.getBoundingClientRect().top;
  await screen.rerender(<SourceBoundaryLayout expanded />);
  const expanding = animations();
  for (const animation of expanding) {
    animation.pause();
    animation.currentTime = 0;
  }
  expect(Math.abs(title.getBoundingClientRect().top - beforeReversal)).toBeLessThanOrEqual(1);
  for (const time of [0, 90, 180]) {
    for (const animation of expanding) animation.currentTime = time;
    expect(
      Math.abs(title.getBoundingClientRect().top - box.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(1);
    expect(held.getBoundingClientRect().top).toBe(280);
  }
});

it("starts a fresh drag after release without resurrecting outgoing destination chrome", async () => {
  await using screen = await render(<Layout dragging={false} />);
  await screen.rerender(<Layout dragging />);
  const old = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  const [expanding] = old.getAnimations();
  expanding!.pause();
  expanding!.currentTime = 60;
  await screen.rerender(<Layout dragging={false} />);
  expect(screen.container.querySelector('[data-testid="sidebar-destination:pinned"]')).toBeNull();
  expect(screen.container.querySelector('[aria-hidden="true"]')).toBeNull();
  await screen.rerender(<Layout dragging />);
  const box = screen.container.querySelector<HTMLElement>(
    '[data-testid="sidebar-destination:pinned"]',
  )!;
  const [returning] = box.getAnimations();
  returning!.pause();
  returning!.currentTime = 0;
  expect(box.getBoundingClientRect().height).toBe(32);
  expect(screen.container.querySelector('[aria-hidden="true"]')).toBeNull();
  expect(
    screen.container.querySelectorAll('[data-testid="sidebar-destination:pinned"]'),
  ).toHaveLength(1);
});
