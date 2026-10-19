import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) !== 24) {
  throw new Error("Use Node 24 (see .node-version), then rerun pnpm fork:check.");
}
const run = (command, args) => NodeChildProcess.execFileSync(command, args, { stdio: "inherit" });
const git = (...args) => NodeChildProcess.execFileSync("git", args, { encoding: "utf8" });
const base = process.argv[2] ?? "HEAD";
const files = [
  ...new Set([
    ...git("diff", "--name-only", "--diff-filter=ACMR", "-z", base).split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ]),
].filter(
  (file) => file && !file.startsWith(".github/upstream-workflows/") && NodeFS.existsSync(file),
);
const vp = NodeURL.fileURLToPath(new URL("../node_modules/vite-plus/bin/vp", import.meta.url));
const sourceFiles = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
const formattedFiles = files.filter((file) => /\.(?:[cm]?[jt]sx?|css|json|md|ya?ml)$/.test(file));

if (formattedFiles.length) run(process.execPath, [vp, "fmt", "--check", ...formattedFiles]);
if (sourceFiles.length) {
  run(process.execPath, [vp, "lint", "--report-unused-disable-directives", ...sourceFiles]);
}
run("pnpm", ["--filter", "@t3tools/web", "--filter", "@t3tools/shared", "typecheck"]);
run(process.execPath, [
  vp,
  "test",
  "run",
  "apps/web/src/themePalette.test.ts",
  "apps/web/src/themeBoot.test.ts",
]);
run("git", ["diff", "--check", base]);
