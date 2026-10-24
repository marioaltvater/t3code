import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import type {
  AssetResource,
  AssetCreateUrlResult,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

import { openUrlInPreview, type OpenPreviewMutation } from "~/browser/openFileInPreview";
import {
  pinnedPageFromSnapshot,
  samePinnedPage,
  type PinnedBrowserPage,
} from "~/pinnedBrowserPagesStore";
import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { pinnedPageAssetResource } from "~/browser/pinnedPageAsset";

export async function openPinnedBrowserPage<E, AssetError = never>(input: {
  threadRef: ScopedThreadRef;
  page: PinnedBrowserPage;
  openPreview: OpenPreviewMutation<E>;
  httpBaseUrl?: string | null;
  createAssetUrl?: (input: {
    environmentId: EnvironmentId;
    input: { resource: AssetResource };
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, AssetError>>;
}) {
  const existing = Object.values(readThreadPreviewState(input.threadRef).sessions).find(
    (snapshot) => {
      if (snapshot.navStatus._tag === "LoadFailed") return false;
      const page = pinnedPageFromSnapshot(snapshot);
      return page !== null && samePinnedPage(page, input.page);
    },
  );
  if (existing) {
    setActivePreviewTab(input.threadRef, existing.tabId);
    useRightPanelStore.getState().openBrowser(input.threadRef, existing.tabId);
    return AsyncResult.success(undefined);
  }
  let url = input.page.url;
  const resource = pinnedPageAssetResource(url, input.threadRef);
  if (
    resource &&
    input.createAssetUrl &&
    input.httpBaseUrl &&
    new URL(url).origin === new URL(input.httpBaseUrl).origin
  ) {
    const result = await input.createAssetUrl({
      environmentId: input.threadRef.environmentId,
      input: { resource },
    });
    if (result._tag === "Failure") return result;
    const refreshed = new URL(result.value.relativeUrl, input.httpBaseUrl);
    refreshed.search = new URL(url).search;
    refreshed.hash = new URL(url).hash;
    url = refreshed.href;
  } else if (resource && input.createAssetUrl && !input.httpBaseUrl) {
    return AsyncResult.failure(
      Cause.fail(new Error("Connect to this environment to reopen its pinned document.")),
    );
  }
  return openUrlInPreview({
    threadRef: input.threadRef,
    url,
    profileId: input.page.profileId,
    openPreview: input.openPreview,
  });
}
