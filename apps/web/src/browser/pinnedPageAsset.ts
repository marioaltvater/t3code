import { AssetResource, type ScopedThreadRef } from "@t3tools/contracts";
import { resolveWorkspaceFilePath } from "@t3tools/shared/path";
import * as Schema from "effect/Schema";

const decodeResource = Schema.decodeUnknownSync(AssetResource);

function assetClaims(url: URL) {
  const match = /^\/api\/assets\/([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\/(.+)$/.exec(url.pathname);
  if (!match) return null;
  const base64 = match[1]!.replaceAll("-", "+").replaceAll("_", "/");
  const claims = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))),
  ) as Record<string, unknown>;
  return claims.version === 1 ? { claims, path: match[2]! } : null;
}

export function pinnedPageUrlKey(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const asset = assetClaims(url);
    if (!asset) return rawUrl;
    const { expiresAt: _expiresAt, ...identity } = asset.claims;
    return JSON.stringify([url.origin, identity, asset.path, url.search, url.hash]);
  } catch {
    return rawUrl;
  }
}

// Claims are a resource hint, never proof of access. The authenticated createUrl
// query rechecks access before minting a fresh URL for a saved document.
export function pinnedPageAssetResource(
  rawUrl: string,
  ref: ScopedThreadRef,
): AssetResource | null {
  try {
    const url = new URL(rawUrl);
    const asset = assetClaims(url);
    if (!asset) return null;
    const { claims } = asset;
    let resource: unknown;
    if (claims.kind === "attachment") {
      resource = {
        _tag: "attachment",
        attachmentId: claims.attachmentId,
        ...(typeof claims.fileName === "string" ? { fileName: claims.fileName } : {}),
        ...(typeof claims.mimeType === "string" ? { mimeType: claims.mimeType } : {}),
        ...(claims.renderIntent === "mcp-app" ? { renderIntent: "mcp-app" } : {}),
        disposition: "inline",
      };
    } else if (claims.kind === "media-file-exact") {
      resource = { _tag: "media-file", threadId: ref.threadId, path: claims.filePath };
    } else if (typeof claims.workspaceRoot === "string") {
      const relativePath =
        claims.kind === "workspace-file-exact"
          ? claims.relativePath
          : claims.kind === "workspace-file" && typeof claims.baseRelativePath === "string"
            ? `${claims.baseRelativePath}/${decodeURIComponent(asset.path)}`
            : null;
      if (typeof relativePath !== "string") return null;
      resource = {
        _tag: "media-file",
        threadId: ref.threadId,
        path: resolveWorkspaceFilePath(relativePath, claims.workspaceRoot),
      };
    } else return null;
    return decodeResource(resource);
  } catch {
    return null;
  }
}
