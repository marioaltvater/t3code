import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

import {
  canAutoScrollSidebarSource,
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
          <div
            role="treeitem"
            data-sidebar-row="held"
            style={{ position: "fixed", top: 0, left: 0, height: 36 }}
          >
            Held
          </div>
        </li>
      </ul>
    </div>,
  );
  const viewport = screen.container.querySelector<HTMLElement>('[data-testid="viewport"]')!;
  const held = screen.container.querySelector<HTMLElement>('[data-thread-item="held"]')!;
  const card = held.querySelector<HTMLElement>("[data-sidebar-row]")!;
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

it("auto-scrolls only inside the source viewport, leaving destination boxes and outer scrolling alone", async () => {
  await using screen = await render(
    <div data-testid="outer" style={{ height: 200, overflowY: "auto" }}>
      <ul style={{ margin: 0, padding: 0 }}>
        <li data-testid="pinned" style={{ height: 64 }}>
          Pinned
        </li>
        <li data-sidebar-source-list style={{ height: 100, overflowY: "auto" }}>
          <div style={{ height: 500 }}>Threads</div>
        </li>
        <li data-testid="settled" style={{ height: 96 }}>
          Settled
        </li>
      </ul>
    </div>,
  );
  const source = screen.container.querySelector<HTMLElement>("[data-sidebar-source-list]")!;
  const bounds = source.getBoundingClientRect();
  expect(canAutoScrollSidebarSource(source, bounds.top + 1)).toBe(true);
  expect(canAutoScrollSidebarSource(source, bounds.bottom - 1)).toBe(true);
  expect(canAutoScrollSidebarSource(source, bounds.top - 1)).toBe(false);
  expect(canAutoScrollSidebarSource(source, bounds.bottom + 1)).toBe(false);
  for (const id of ["outer", "pinned", "settled"]) {
    const element = screen.container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    expect(canAutoScrollSidebarSource(element, bounds.bottom - 1)).toBe(false);
  }
});

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("keeps the title when dragging a search result from a collapsed folder", async () => {
  await page.viewport(1400, 900);
  const [first, second] = [threadWithHistory("visible", 1), threadWithHistory("search-target", 1)];
  using _environment = installFakeEnvironment([first, second]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: true,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  const folder = page.getByRole("treeitem", { name: /^render/ });
  await expect.element(folder).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(folder);
  await expect.element(page.getByText(second.title, { exact: true })).not.toBeInTheDocument();
  await userEvent.fill(page.getByRole("combobox", { name: "Search threads" }), "search-target");
  const result = page.getByRole("option", { name: /Thread search-target/ });
  await expect.element(result).toBeVisible();
  const bounds = result.element().getBoundingClientRect();
  const pointer = (type: string, x: number, y: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
    });
  using _release = {
    [Symbol.dispose]: () => document.dispatchEvent(pointer("pointerup", -100, 100)),
  };
  await act(() => {
    result.element().dispatchEvent(pointer("pointerdown", bounds.x + 10, bounds.y + 10));
    document.dispatchEvent(pointer("pointermove", -100, 100));
  });
  await vi.waitFor(() => {
    expect(
      document.querySelector('body > div[aria-hidden="true"].pointer-events-none')?.textContent,
    ).toBe(second.title);
  });
});
