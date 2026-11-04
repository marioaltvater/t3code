import {
  DEFAULT_BROWSER_PROFILE_ID,
  EnvironmentId,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../test/render";
import { dismissContextMenu } from "~/contextMenuFallback";
import { usePinnedBrowserPagesStore } from "~/pinnedBrowserPagesStore";
import { RightPanelTabs, type RightPanelTabsProps } from "./RightPanelTabs";

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
