# Personal T3 Code fork

[marioaltvater/t3code](https://github.com/marioaltvater/t3code) follows
[pingdotgg/t3code](https://github.com/pingdotgg/t3code). The upstream license and
history are retained. This fork concentrates on the web interface, which is also
used inside the desktop app.

## Develop locally

Use Node **24.18.0** (`.node-version` / `.nvmrc`) and pnpm **11.10.0** (pinned in
`package.json`). With nvm installed:

```sh
git clone https://github.com/marioaltvater/t3code.git
cd t3code
nvm install
nvm use
corepack enable
pnpm fork:setup
pnpm fork:dev
```

`fork:setup` installs the web, server, development scripts and lint dependencies
using the committed lockfile. `fork:dev` starts the web and server with state in
this checkout's ignored `.t3/`. Read the actual web URL from the dev-runner output;
ports depend on the checkout path. Stop it with Ctrl+C. Keep this checkout for
ongoing use so its local chats and settings remain available.

Provider CLIs still need their normal installation and authentication. Do not
set `VITE_HTTP_URL` or `VITE_WS_URL`; development uses the built-in same-origin
proxy. The fork command explicitly isolates T3 state from the official install;
`.t3/`, `.env*` and provider credentials must stay out of Git.

For a full desktop/mobile setup, use the upstream
[development guide](docs/operations/development.md). This fork's quick setup and
CI cover the web development path; they do not build desktop installers.

## Appearance

Choose **Codex** in **Settings → Appearance**, with dark appearance. This keeps
the upstream themes available and saves your selection locally.

| Surface         | Color     |
| --------------- | --------- |
| Canvas          | `#111111` |
| Sidebar         | `#101010` |
| Selected thread | `#212121` |
| User message    | `#1d1d1d` |
| Composer        | `#2b2b2b` |
| Accent          | `#0169cc` |

The Codex theme uses solid surfaces and bundled Geist fonts. SF Mono is used
when installed, with system monospace fallbacks. Geist's OFL license is included
beside the font files. The sidebar artwork and wordmark are removed while the
sidebar toggle remains available. Thread search shows the current match and
keyboard shortcuts.

## Check changes

```sh
pnpm fork:check
```

This checks formatting and lint for changed/untracked source files, web and
shared TypeScript types, the existing theme palette tests, and whitespace. To
check committed changes as well, supply a base commit or branch:

```sh
pnpm fork:check upstream/main
```

Fork CI runs the same checks against the push or pull request base on an Ubuntu
runner. Verify rendering, composer interaction and sidebar collapse/reopen in
the browser after UI changes. Backend/provider changes need additional focused
checks from the upstream development guide.

## Pull upstream updates

Set this once after cloning:

```sh
git remote add upstream https://github.com/pingdotgg/t3code.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
```

Start with a clean working tree, then merge on an update branch:

```sh
git fetch upstream main
git switch -c update/upstream
git merge upstream/main
pnpm fork:setup
pnpm fork:check origin/main
pnpm fork:dev
```

Resolve conflicts while preserving the small UI changes. Inspect
`.github/workflows/` before pushing: upstream publishing, deployment and service
workflows are archived in `.github/upstream-workflows/` and are intentionally
inactive here. A merge can introduce new active workflows; archive those too
unless deliberately enabled for this fork. Only `fork-ci.yml` should be active.

After checking the UI and the update branch, advance main:

```sh
git switch main
git merge --ff-only update/upstream
git push origin main
```

Keep updates as ordinary merges, with personal changes in small commits. Do not
force-push shared main or overwrite this fork with GitHub's discard-changes sync.
