import {
  DEFAULT_BROWSER_PROFILE_ID,
  EnvironmentId,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render, stubGlobal } from "../../test/render";
import { dismissContextMenu } from "~/contextMenuFallback";
import { usePinnedBrowserPagesStore } from "~/pinnedBrowserPagesStore";
import { RightPanelTabs, type RightPanelTabsProps } from "./RightPanelTabs";
import type { RightPanelSurface } from "~/rightPanelStore";
import { HistorySwipeNavigation } from "./HistorySwipeNavigation";

vi.mock(import("~/browser/browserDefaults"), async (original) => {
  const actual = await original();
  return { ...actual, useBrowserDefaults: actual.getBrowserDefaults };
});

const ref = {
  environmentId: EnvironmentId.make("pin-test-environment"),
  threadId: ThreadId.make("pin-test-thread"),
};

function setup() {
  usePinnedBrowserPagesStore.setState({ byThreadKey: {} });
  const noop = vi.fn();
  const props = {
    mode: "embedded",
    keybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: true,
      isWeb: true,
      isDesktop: false,
    }),
    surfaces: [{ id: "browser:new", kind: "preview", resourceId: null }],
    environmentId: ref.environmentId,
    activeSurfaceId: "browser:new",
    pendingSurfaceIds: new Set<string>(),
    previewSessions: {},
    desktopByTabId: {},
    terminalLabelsById: new Map<string, string>(),
    onActivate: noop,
    onCloseSurface: noop,
    onCloseOtherSurfaces: noop,
    onCloseSurfacesToRight: noop,
    onCloseAllSurfaces: noop,
    onCopyFilePath: noop,
    onAddBrowser: noop,
    onAddBrowserInProfile: noop,
    onAddTerminal: noop,
    onAddDiff: noop,
    onAddFiles: noop,
    onAddPullRequest: noop,
    onAddPullRequests: noop,
    onAddDevice: noop,
    browserAvailable: true,
    terminalAvailable: false,
    diffAvailable: false,
    filesAvailable: false,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
    deviceAvailable: false,
    children: null,
  } satisfies RightPanelTabsProps;
  return props;
}

it("keeps pinning discoverable on an empty tab, then pins and unpins its loaded page", async () => {
  const props = setup();
  await using screen = await render(<RightPanelTabs {...props} />);
  using _menu = { [Symbol.dispose]: dismissContextMenu };
  await userEvent.click(screen.getByRole("button", { name: "Browser", exact: true }), {
    button: "right",
  });
  await expect.element(page.getByRole("menuitem", { name: "Pin page to thread" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");

  const snapshot: PreviewSessionSnapshot = {
    threadId: ref.threadId,
    tabId: "pin-test-tab",
    navStatus: { _tag: "Success", url: "https://example.com/docs", title: "Docs" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-11-05T00:00:00Z",
  };
  await screen.rerender(
    <RightPanelTabs
      {...props}
      surfaces={[{ id: `browser:${snapshot.tabId}`, kind: "preview", resourceId: snapshot.tabId }]}
      activeSurfaceId={`browser:${snapshot.tabId}`}
      previewSessions={{ [snapshot.tabId]: snapshot }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Docs", exact: true }), {
    button: "right",
  });
  await userEvent.click(page.getByRole("menuitem", { name: "Pin page to thread" }));
  expect(usePinnedBrowserPagesStore.getState().byThreadKey[scopedThreadKey(ref)]).toEqual([
    { url: "https://example.com/docs", title: "Docs", profileId: DEFAULT_BROWSER_PROFILE_ID },
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Docs", exact: true }), {
    button: "right",
  });
  await userEvent.click(page.getByRole("menuitem", { name: "Unpin page from thread" }));
  expect(usePinnedBrowserPagesStore.getState().byThreadKey[scopedThreadKey(ref)]).toBeUndefined();
});

const navigateHistory = vi.hoisted(() => vi.fn());
vi.mock("../navigationHistory", () => ({ canNavigateHistory: () => true, navigateHistory }));

// Chromium starts a gesture scroll, and Electron reports its begin, only for a
// wheel event the page did not preventDefault; it then scrolls the latched scroller.
function trackpad() {
  const begin = new Set<() => void>();
  const end = new Set<() => void>();
  const subscribe = (listeners: Set<() => void>) => (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  let scrolling = false;
  return {
    bridge: { onTrackpadScrollBegin: subscribe(begin), onTrackpadScrollEnd: subscribe(end) },
    scroll(target: Element, deltas: readonly number[]) {
      let scroller: Element | null = target;
      while (
        scroller &&
        (scroller.scrollWidth <= scroller.clientWidth ||
          !/auto|scroll/.test(getComputedStyle(scroller).overflowX))
      ) {
        scroller = scroller.parentElement;
      }
      for (const deltaX of deltas) {
        const event = new WheelEvent("wheel", {
          deltaX,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        target.dispatchEvent(event);
        if (event.defaultPrevented) continue;
        if (scroller) scroller.scrollLeft += deltaX;
        if (scrolling) continue;
        scrolling = true;
        for (const listener of begin) listener();
      }
      if (scrolling) for (const listener of end) listener();
      scrolling = false;
    },
  };
}

const surfaces: RightPanelSurface[] = Array.from({ length: 16 }, (_, index) => ({
  id: `terminal:${index}`,
  kind: "terminal",
  resourceId: `${index}`,
  terminalIds: [`${index}`],
  activeTerminalId: `${index}`,
}));

describe("RightPanelTabs", () => {
  it("a flick that scrolls the tab strip to its left edge keeps the thread, a swipe from the edge goes back", async () => {
    navigateHistory.mockReset();
    const { bridge, scroll } = trackpad();
    using _bridge = stubGlobal("desktopBridge", bridge);
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const panel = document.createElement("div");
    panel.style.cssText = "width: 320px; height: 200px; display: flex";
    const noop = () => {};
    await using screen = await render(
      <>
        <HistorySwipeNavigation />
        <RightPanelTabs
          mode="embedded"
          keybindings={[]}
          getShortcutContext={() => ({
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            isWeb: true,
            isDesktop: false,
          })}
          surfaces={surfaces}
          environmentId={null}
          activeSurfaceId={null}
          pendingSurfaceIds={new Set()}
          previewSessions={{}}
          desktopByTabId={{}}
          terminalLabelsById={new Map(surfaces.map((surface) => [surface.id, "Terminal"]))}
          onActivate={noop}
          onCloseSurface={noop}
          onCloseOtherSurfaces={noop}
          onCloseSurfacesToRight={noop}
          onCloseAllSurfaces={noop}
          onCopyFilePath={noop}
          onAddBrowser={noop}
          onAddBrowserInProfile={noop}
          onAddTerminal={noop}
          onAddDiff={noop}
          onAddFiles={noop}
          onAddPullRequest={noop}
          onAddPullRequests={noop}
          onAddDevice={noop}
          browserAvailable={false}
          terminalAvailable
          diffAvailable={false}
          filesAvailable={false}
          pullRequestAvailable={false}
          pullRequestsAvailable={false}
          deviceAvailable={false}
        >
          {null}
        </RightPanelTabs>
      </>,
      { container: panel },
    );
    const viewport = screen.container.querySelector<HTMLElement>(
      '[data-right-panel-tab-list] [data-slot="scroll-area-viewport"]',
    )!;
    expect(viewport.scrollWidth - viewport.clientWidth).toBeGreaterThan(120);
    viewport.scrollLeft = 120;

    const momentum = Array.from({ length: 24 }, (_, index) => -60 * 0.85 ** index);
    scroll(viewport.querySelector("[data-active-tab]")!, [-10, -20, -30, ...momentum]);

    expect(viewport.scrollLeft).toBe(0);
    expect(navigateHistory).not.toHaveBeenCalled();

    viewport.scrollLeft = 0;
    scroll(viewport.querySelector("[data-active-tab]")!, [-40, -40, -40, -40, -40]);

    expect(navigateHistory).toHaveBeenCalledExactlyOnceWith("back");
  });
});
