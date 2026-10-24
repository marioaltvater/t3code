import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { selectSelectedRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { openPinnedBrowserPage } from "./openPinnedBrowserPage";

const threadRef = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("thread") };
const page = { url: "https://example.com/artifact#section", title: "Artifact", profileId: "work" };
const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "existing",
  navStatus: { _tag: "Success", url: page.url, title: page.title },
  profileId: "work",
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-24T00:00:00.000Z",
};

function setup() {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
}

it("reveals an existing matching tab without opening another", async () => {
  setup();
  applyPreviewServerSnapshot(threadRef, snapshot);
  applyPreviewServerSnapshot(threadRef, {
    ...snapshot,
    tabId: "other",
    navStatus: { _tag: "Idle" },
  });
  const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
  await openPinnedBrowserPage({ threadRef, page, openPreview });
  expect(openPreview).not.toHaveBeenCalled();
  expect(readThreadPreviewState(threadRef).activeTabId).toBe("existing");
  expect(
    selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.id,
  ).toBe("browser:existing");
});

it("reopens a closed page in its saved profile and reveals the browser", async () => {
  setup();
  const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
  await openPinnedBrowserPage({ threadRef, page, openPreview });
  expect(openPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId: threadRef.environmentId,
      input: expect.objectContaining({
        threadId: threadRef.threadId,
        url: page.url,
        profileId: "work",
      }),
    }),
  );
  expect(
    selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.id,
  ).toBe("browser:existing");
});

it("does not reuse a tab from another profile or one navigated away", async () => {
  setup();
  applyPreviewServerSnapshot(threadRef, { ...snapshot, profileId: "personal" });
  applyPreviewServerSnapshot(threadRef, {
    ...snapshot,
    tabId: "navigated",
    navStatus: { _tag: "Success", url: "https://example.com/other", title: "Other" },
  });
  const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "new" }));
  await openPinnedBrowserPage({ threadRef, page, openPreview });
  expect(openPreview).toHaveBeenCalledOnce();
  expect(readThreadPreviewState(threadRef).activeTabId).toBe("new");
});

it("returns a failed open without selecting a nonexistent browser tab", async () => {
  setup();
  const result = await openPinnedBrowserPage({
    threadRef,
    page,
    openPreview: async () => AsyncResult.failure(Cause.fail(new Error("offline"))),
  });
  expect(result._tag).toBe("Failure");
  expect(
    selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
  ).toBeNull();
});

it("retries a failed page instead of focusing its stale error tab", async () => {
  setup();
  applyPreviewServerSnapshot(threadRef, {
    ...snapshot,
    navStatus: {
      _tag: "LoadFailed",
      url: page.url,
      title: page.title,
      code: -1,
      description: "offline",
    },
  });
  const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "retry" }));
  await openPinnedBrowserPage({ threadRef, page, openPreview });
  expect(openPreview).toHaveBeenCalledOnce();
  expect(readThreadPreviewState(threadRef).activeTabId).toBe("retry");
});

it("renews an expired T3 document URL before opening and preserves its fragment", async () => {
  setup();
  const token = Buffer.from(
    JSON.stringify({
      version: 1,
      kind: "attachment",
      attachmentId: "artifact-1",
      mimeType: "text/html",
      expiresAt: 1,
    }),
  ).toString("base64url");
  const pinned = {
    ...page,
    url: `https://environment.test/api/assets/${token}.signature/artifact.html?mode=print#section`,
  };
  const createAssetUrl = vi.fn(async () =>
    AsyncResult.success({
      relativeUrl: "/api/assets/fresh.signature/artifact.html",
      expiresAt: 500,
    }),
  );
  const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
  await openPinnedBrowserPage({
    threadRef,
    page: pinned,
    openPreview,
    createAssetUrl,
    httpBaseUrl: "https://environment.test",
  });
  expect(createAssetUrl).toHaveBeenCalledWith({
    environmentId: threadRef.environmentId,
    input: {
      resource: {
        _tag: "attachment",
        attachmentId: "artifact-1",
        mimeType: "text/html",
        disposition: "inline",
      },
    },
  });
  expect(openPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        url: "https://environment.test/api/assets/fresh.signature/artifact.html?mode=print#section",
      }),
    }),
  );
});

it("keeps the browser closed when renewing a pinned document is denied", async () => {
  setup();
  const token = Buffer.from(
    JSON.stringify({ version: 1, kind: "attachment", attachmentId: "artifact-1", expiresAt: 1 }),
  ).toString("base64url");
  const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
  const result = await openPinnedBrowserPage({
    threadRef,
    page: { ...page, url: `https://environment.test/api/assets/${token}.signature/artifact.html` },
    openPreview,
    httpBaseUrl: "https://environment.test",
    createAssetUrl: async () => AsyncResult.failure(Cause.fail(new Error("denied"))),
  });
  expect(result._tag).toBe("Failure");
  expect(openPreview).not.toHaveBeenCalled();
});

it("does not reinterpret asset-shaped URLs on other websites", async () => {
  setup();
  const token = Buffer.from(
    JSON.stringify({ version: 1, kind: "attachment", attachmentId: "artifact-1", expiresAt: 1 }),
  ).toString("base64url");
  const url = `https://external.test/api/assets/${token}.signature/artifact.html`;
  const createAssetUrl = vi.fn(async () =>
    AsyncResult.success({ relativeUrl: "/fresh", expiresAt: 500 }),
  );
  const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
  await openPinnedBrowserPage({
    threadRef,
    page: { ...page, url },
    openPreview,
    createAssetUrl,
    httpBaseUrl: "https://environment.test",
  });
  expect(createAssetUrl).not.toHaveBeenCalled();
  expect(openPreview).toHaveBeenCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ url }) }),
  );
});
