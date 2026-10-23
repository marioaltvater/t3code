import { RunId, CheckpointRef } from "@t3tools/contracts";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  selectLatestTurnDiff,
  useDiffPanelSessionStore,
  useDiffPanelStore,
} from "./diffPanelStore";

function checkpointSummary(
  runId: string,
  checkpointTurnCount: number,
  completedAt: string,
  files: ThreadCheckpointSummary["files"] = [],
): ThreadCheckpointSummary {
  return {
    runId: RunId.make(runId),
    checkpointTurnCount,
    completedAt,
    checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${runId}`),
    status: "ready",
    files,
    assistantMessageId: null,
  };
}

it("selects the latest turn even when an earlier turn has changes and the latest has none", () => {
  const older = checkpointSummary("older", 1, "2026-10-21T11:00:00Z", [
    { path: "app.ts", kind: "modified", additions: 3, deletions: 1 },
  ]);
  const latest = checkpointSummary("latest", 2, "2026-10-21T10:00:00Z");
  expect(selectLatestTurnDiff([latest, older])).toBe(latest);
});

it("uses the newest checkpoint for the same turn and leaves an empty history unavailable", () => {
  const older = checkpointSummary("older", 2, "2026-10-21T10:00:00Z");
  const latest = checkpointSummary("latest", 2, "2026-10-21T11:00:00Z");
  expect(selectLatestTurnDiff([latest, older])).toBe(latest);
  expect(selectLatestTurnDiff([])).toBeUndefined();
});

describe("diffPanelStore", () => {
  beforeEach(() => {
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
    });
    useDiffPanelSessionStore.setState({ collapsedFileKeysByScopeKey: {} });
  });

  it("retains fold choices when a panel consumer returns with fresh defaults", () => {
    const scopeKey = "environment-1:thread-1:branch";
    const defaults = new Set(["src/app.ts", "src/index.ts"]);
    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, defaults, (current) => {
      const next = new Set(current);
      next.delete("src/app.ts");
      return next;
    });

    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(["src/index.ts"]),
    );

    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, new Set(), (current) => {
      const next = new Set(current);
      next.delete("src/index.ts");
      return next;
    });
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );

    useDiffPanelSessionStore
      .getState()
      .updateCollapsedFileKeys(scopeKey, defaults, (current) => current);
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );
    expect(defaults).toEqual(new Set(["src/app.ts", "src/index.ts"]));
  });
});
