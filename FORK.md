# Personal T3 Code fork

[marioaltvater/t3code](https://github.com/marioaltvater/t3code) follows
[pingdotgg/t3code](https://github.com/pingdotgg/t3code). The upstream license and
history are retained. This fork concentrates on the web interface, which is also
used inside the desktop app.

## Develop locally

Use Node **26.12.1** (`.node-version` / `.nvmrc`) and pnpm **12.14.0** (pinned in
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

## Install the Linux desktop app

This builds the actual Electron app, with its bundled web interface and local
server. It runs independently of the web development server.

On Fedora, install `gcc`, `pkgconf-pkg-config`, `libsecret-devel`, `cargo` and
`rust`. Then use Node 26.12.1 and the pinned pnpm version:

```sh
pnpm fork:desktop:setup
pnpm fork:desktop:build
pnpm fork:desktop:install
```

Launch **T3 Code Personal** from the application menu. The AppImage is installed
at `~/Applications/T3-Code-Personal.AppImage`; the launcher is
`~/.local/share/applications/t3-code-personal.desktop`. Installing again keeps a
backup of the previous AppImage. No system package installation is needed.

The fork uses `~/.t3-personal` for its own data and a separate Chromium profile.
It registers `t3code-personal://` links and does not replace the official app's
launcher or profile. Fresh profiles open in Codex dark; existing saved
appearance preferences remain respected. Automatic upstream updates are disabled;
rebuild and run the install command after updating the fork. Your existing
provider CLI logins remain usable, while conversations and app settings start
in the personal profile.

For other platforms, use the upstream
[development guide](docs/operations/development.md). The fork CI covers web and
theme checks; the installed Linux artifact is validated separately.

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

The Codex theme uses solid surfaces, Geist for interface text, and Geist Mono
for code and terminal text. Both fonts are bundled with their OFL licenses beside
the font files. Geist Mono is sourced from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/geistmono). The sidebar artwork and wordmark are removed while the
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

Save any uncommitted work and create a backup branch before updating. Merge the
latest stable release tag on an update branch; keep nightly updates deliberate:

```sh
git fetch upstream tag v0.1.1
git branch backup/pre-v0.1.1
git switch -c update/stable-v0.1.1
git merge v0.1.1
pnpm fork:setup
pnpm fork:check v0.1.1
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
git merge --ff-only update/stable-v0.1.1
git push origin main
```

Before rebuilding, update the personal build version in `package.json` to match
the release (for example, `0.1.1-personal.1`). Test the rebuilt app with isolated
state before installing it. Installation keeps the previous AppImage as a backup.

Keep updates as ordinary merges, with personal changes in small commits. Do not
force-push shared main or overwrite this fork with GitHub's discard-changes sync.
