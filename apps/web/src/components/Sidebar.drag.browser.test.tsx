import { expect, it } from "vite-plus/test";
import { render } from "../../test/render";
import {
  measureSidebarDropTarget,
  positionSidebarDragCard,
  sidebarSourceSortingStrategy,
} from "./Sidebar.drag";

it.each([36, 82])(
  "keeps source peers in their slots while a %spx card follows the pointer",
  async (height) => {
    await using screen = await render(
      <ul
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: 260,
          padding: 0,
          margin: 0,
        }}
      >
        <li data-thread-item="held" style={{ height, flexShrink: 0 }}>
          Held
        </li>
        <li data-thread-item="peer" style={{ height, flexShrink: 0 }}>
          Remaining
        </li>
      </ul>,
    );
    const held = screen.container.querySelector<HTMLElement>('[data-thread-item="held"]')!;
    const peer = screen.container.querySelector<HTMLElement>('[data-thread-item="peer"]')!;
    const original = [measureSidebarDropTarget(held), measureSidebarDropTarget(peer)];
    const peerTops = [];
    for (const pointerOffset of [height + 8, 200, 400, 600, -200]) {
      held.style.transform = `translateY(${pointerOffset}px)`;
      const rects = [measureSidebarDropTarget(held), measureSidebarDropTarget(peer)];
      expect(rects).toEqual(original);
      const displacement = sidebarSourceSortingStrategy({
        rects,
        activeIndex: 0,
        overIndex: -1,
        index: 1,
        activeNodeRect: rects[0]!,
      });
      peer.style.transform = `translateY(${displacement?.y ?? 0}px)`;
      peerTops.push(peer.getBoundingClientRect().top);
    }
    expect(peerTops).toEqual(Array(5).fill(original[0]!.top));
  },
);

it("keeps the remaining full-size card in first position when only the held card shrinks", async () => {
  await using screen = await render(
    <ul
      style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, padding: 0 }}
    >
      <li data-thread-item="held" style={{ height: 82, flexShrink: 0 }}>
        Held
      </li>
      <li data-thread-item="peer" style={{ height: 82, flexShrink: 0 }}>
        Remaining
      </li>
    </ul>,
  );
  const held = screen.container.querySelector<HTMLElement>('[data-thread-item="held"]')!;
  const peer = screen.container.querySelector<HTMLElement>('[data-thread-item="peer"]')!;
  const top = measureSidebarDropTarget(held).top;
  for (const height of [82, 36, 82, 36]) {
    held.style.height = `${height}px`;
    held.style.transform = "translateY(500px)";
    const rects = [measureSidebarDropTarget(held), measureSidebarDropTarget(peer)];
    const displacement = sidebarSourceSortingStrategy({
      rects,
      activeIndex: 0,
      overIndex: -1,
      index: 1,
      activeNodeRect: rects[0]!,
    });
    peer.style.transform = `translateY(${displacement?.y ?? 0}px)`;
    expect(peer.getBoundingClientRect().top).toBe(top);
    expect(peer.getBoundingClientRect().height).toBe(82);
  }
});

it("keeps a fixed held card under the pointer while its outer list scrolls", async () => {
  await using screen = await render(
    <div data-testid="viewport" style={{ height: 100, overflowY: "auto", marginTop: 160 }}>
      <ul style={{ height: 900, margin: 0, padding: 0 }}>
        <li data-thread-item="held" style={{ height: 82, listStyle: "none" }}>
          <div role="button" style={{ position: "fixed", top: 0, left: 0, height: 36 }}>
            Held
          </div>
        </li>
      </ul>
    </div>,
  );
  const viewport = screen.container.querySelector<HTMLElement>('[data-testid="viewport"]')!;
  const held = screen.container.querySelector<HTMLElement>('[data-thread-item="held"]')!;
  const card = held.querySelector<HTMLElement>('[role="button"]')!;
  const origin = held.getBoundingClientRect().top;
  const pointerTop = origin + 20;
  for (const scroll of [0, 300, 600, 0]) {
    viewport.scrollTop = scroll;
    positionSidebarDragCard(held, {
      pointerY: pointerTop + 18,
      grabFraction: 0.5,
      bounds: { top: 0, height: 1000 },
    });
    expect(card.getBoundingClientRect().top).toBe(pointerTop);
  }
});
