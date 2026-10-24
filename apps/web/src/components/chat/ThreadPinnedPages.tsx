import { AuthPreviewOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Globe2, PinOff } from "lucide-react";
import { useState } from "react";

import { usePreviewAvailable } from "~/browser/previewRuntime";
import { cn } from "~/lib/utils";
import {
  usePinnedBrowserPages,
  usePinnedBrowserPagesStore,
  type PinnedBrowserPage,
} from "~/pinnedBrowserPagesStore";
import { previewEnvironment } from "~/state/preview";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { assetEnvironment } from "~/state/assets";
import { readPreparedConnection } from "~/state/session";
import { openPinnedBrowserPage } from "../preview/openPinnedBrowserPage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadPinnedPages({ threadRef }: { threadRef: ScopedThreadRef }) {
  const pages = usePinnedBrowserPages(threadRef);
  const available = usePreviewAvailable(threadRef.environmentId);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const [opening, setOpening] = useState(false);

  function open(page: PinnedBrowserPage) {
    setOpening(true);
    void openPinnedBrowserPage({
      threadRef,
      page,
      openPreview,
      createAssetUrl,
      httpBaseUrl: readPreparedConnection(threadRef.environmentId)?.httpBaseUrl ?? null,
    })
      .then((result) => {
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          toastManager.add({
            type: "error",
            title: "Could not open pinned page",
            description: String(squashAtomCommandFailure(result)),
          });
        }
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not open pinned page",
          description: String(error),
        });
      })
      .finally(() => {
        setOpening(false);
      });
  }

  if (pages.length === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-pinned-pages-heading"
      title="Pinned pages"
      showHeading={false}
    >
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {pages.map((page) => (
          <div
            key={JSON.stringify([page.url, page.profileId])}
            className="group relative flex min-w-0 items-center rounded-lg"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    type="button"
                    part="actionRow"
                    disabled={!available || !canOperate || opening}
                    onClick={() => void open(page)}
                  />
                }
              >
                <Globe2 className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                  {page.title || page.url}
                </span>
              </TooltipTrigger>
              <TooltipPopup>
                {!available
                  ? "The integrated browser is unavailable."
                  : !canOperate
                    ? "Pair this client with preview access to open pinned pages."
                    : page.url}
              </TooltipPopup>
            </Tooltip>
            <div className="absolute inset-y-0 end-1 flex items-center">
              <ThreadDetailsControl
                part="icon"
                aria-label={`Unpin ${page.title || page.url}`}
                onClick={() => usePinnedBrowserPagesStore.getState().unpin(threadRef, page)}
              >
                <PinOff />
              </ThreadDetailsControl>
            </div>
          </div>
        ))}
      </div>
    </ThreadDetailsSection>
  );
}
