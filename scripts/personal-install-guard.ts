// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
import { extractFile } from "@electron/asar";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export function appImageCommit(artifact: string) {
  const offset = NodeChildProcess.execFileSync(artifact, ["--appimage-offset"], {
    encoding: "utf8",
  }).trim();
  if (!/^\d+$/.test(offset)) throw new Error(`Invalid AppImage offset: ${artifact}`);
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-personal-install-"));
  try {
    NodeChildProcess.execFileSync(
      "unsquashfs",
      ["-no-progress", "-o", offset, "-d", directory, artifact, "resources/app.asar"],
      {
        stdio: "pipe",
      },
    );
    const metadata: { t3codeCommitHash?: unknown } = JSON.parse(
      extractFile(NodePath.join(directory, "resources/app.asar"), "package.json").toString(),
    );
    if (
      typeof metadata.t3codeCommitHash !== "string" ||
      !/^[0-9a-f]{7,40}$/.test(metadata.t3codeCommitHash)
    ) {
      throw new Error(`Missing embedded source commit: ${artifact}`);
    }
    return metadata.t3codeCommitHash;
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

export function requireUpgrade(repo: string, installed: string | null, candidate: string) {
  // Existing builds embed abbreviated hashes; Git rejects missing or ambiguous objects.
  for (const commit of [installed, candidate]) {
    if (!commit) continue;
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("Invalid source commit");
    NodeChildProcess.execFileSync(
      "git",
      ["-C", repo, "rev-parse", "--verify", `${commit}^{commit}`],
      {
        stdio: "pipe",
      },
    );
  }
  if (installed) {
    try {
      NodeChildProcess.execFileSync(
        "git",
        ["-C", repo, "merge-base", "--is-ancestor", installed, candidate],
        {
          stdio: "pipe",
        },
      );
    } catch {
      throw new Error(
        `Refusing to drop installed work (${installed.slice(0, 12)}). Merge that commit into the release branch and rebuild; candidate is ${candidate.slice(0, 12)}.`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  try {
    const [repo, candidatePath, installedPath] = process.argv.slice(2);
    if (!repo || !candidatePath || !installedPath)
      throw new Error("Expected repo, candidate, and installed paths");
    const candidate = appImageCommit(NodePath.resolve(candidatePath));
    const installed = NodeFS.existsSync(installedPath)
      ? appImageCommit(NodePath.resolve(installedPath))
      : null;
    requireUpgrade(repo, installed, candidate);
    console.log(`Verified cumulative personal release: ${candidate}`);
  } catch (error) {
    console.error(
      `Personal install blocked: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
