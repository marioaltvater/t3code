import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { pinnedPageAssetResource, pinnedPageUrlKey } from "./pinnedPageAsset";

const ref = { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("thread") };

function assetUrl(claims: Record<string, unknown>, fileName = "page.html") {
  return `https://environment.test/api/assets/${Buffer.from(JSON.stringify({ version: 1, expiresAt: 1, ...claims })).toString("base64url")}.signature/${encodeURIComponent(fileName)}#section`;
}

it("recovers an HTML attachment reference after the signed URL expires", () => {
  const url = assetUrl({
    kind: "attachment",
    attachmentId: "attachment-1",
    fileName: "Résumé.html",
    mimeType: "text/html",
  });
  expect(pinnedPageAssetResource(url, ref)).toEqual({
    _tag: "attachment",
    attachmentId: "attachment-1",
    fileName: "Résumé.html",
    mimeType: "text/html",
    disposition: "inline",
  });
});

it("recovers workspace and media file paths for the authenticated URL query", () => {
  expect(
    pinnedPageAssetResource(
      assetUrl({ kind: "workspace-file", workspaceRoot: "/project", baseRelativePath: "docs" }),
      ref,
    ),
  ).toEqual({ _tag: "media-file", threadId: ref.threadId, path: "/project/docs/page.html" });
  expect(
    pinnedPageAssetResource(
      assetUrl({ kind: "media-file-exact", filePath: "/tmp/page.html" }),
      ref,
    ),
  ).toEqual({ _tag: "media-file", threadId: ref.threadId, path: "/tmp/page.html" });
  expect(
    pinnedPageAssetResource(
      assetUrl({
        kind: "workspace-file-exact",
        workspaceRoot: "C:\\project",
        relativePath: "docs/page.html",
      }),
      ref,
    ),
  ).toEqual({ _tag: "media-file", threadId: ref.threadId, path: "C:\\project\\docs\\page.html" });
});

it("matches renewed document URLs but keeps origins and fragments separate", () => {
  const original = assetUrl({ kind: "attachment", attachmentId: "one" });
  const renewed = assetUrl({ kind: "attachment", attachmentId: "one", expiresAt: 500 });
  expect(pinnedPageUrlKey(original)).toBe(pinnedPageUrlKey(renewed));
  expect(pinnedPageUrlKey(original)).not.toBe(
    pinnedPageUrlKey(renewed.replace("#section", "#other")),
  );
  expect(pinnedPageUrlKey(original)).not.toBe(
    pinnedPageUrlKey(renewed.replace("environment.test", "another.test")),
  );
});

it("ignores ordinary URLs and malformed or unsupported asset payloads", () => {
  for (const url of [
    "https://example.com/page",
    "https://environment.test/api/assets/bad.signature/page.html",
    assetUrl({ kind: "unknown" }),
    assetUrl({ kind: "attachment", attachmentId: 42 }),
  ]) {
    expect(pinnedPageAssetResource(url, ref)).toBeNull();
  }
});
