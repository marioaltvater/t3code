// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it } from "vite-plus/test";
import { requireUpgrade } from "./personal-install-guard.ts";

it("accepts only releases containing the installed commit", () => {
  const repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-install-history-"));
  try {
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    git("init", "--initial-branch=main");
    const commit = (message: string) => {
      git(
        "-c",
        "user.name=Install Guard Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        message,
      );
      return git("rev-parse", "HEAD");
    };
    const base = commit("base");
    const installed = commit("controller work");
    const cumulative = commit("sidebar work");
    git("checkout", "--detach", base);
    const unrelated = commit("sidebar without controller");

    NodeAssert.doesNotThrow(() => requireUpgrade(repo, null, installed));
    NodeAssert.doesNotThrow(() => requireUpgrade(repo, installed, installed));
    NodeAssert.doesNotThrow(() => requireUpgrade(repo, installed, cumulative));
    NodeAssert.doesNotThrow(() =>
      requireUpgrade(repo, installed.slice(0, 12), cumulative.slice(0, 12)),
    );
    NodeAssert.throws(
      () => requireUpgrade(repo, installed, base),
      /Refusing to drop installed work/,
    );
    NodeAssert.throws(
      () => requireUpgrade(repo, installed, unrelated),
      /Refusing to drop installed work/,
    );
    NodeAssert.throws(() => requireUpgrade(repo, installed, "f".repeat(40)));
  } finally {
    NodeFS.rmSync(repo, { recursive: true, force: true });
  }
});
