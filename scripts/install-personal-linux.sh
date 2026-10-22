#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact="${1:-}"
if [[ -z "$artifact" ]]; then
  shopt -s nullglob
  artifacts=("$repo_dir"/release/personal/T3-Code-Personal-*.AppImage)
  if [[ ${#artifacts[@]} -ne 1 ]]; then
    echo "Pass the AppImage path when release/personal does not contain exactly one build." >&2
    exit 1
  fi
  artifact="${artifacts[0]}"
fi
if [[ ! -f "$artifact" ]]; then
  echo "Build the app first with pnpm fork:desktop:build, or pass an AppImage path." >&2
  exit 1
fi
app_dir="$HOME/Applications"
applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icon_dir="${XDG_DATA_HOME:-$HOME/.local/share}/icons"
app_path="$app_dir/T3-Code-Personal.AppImage"
mkdir -p "$app_dir" "$applications_dir" "$icon_dir"
# Hold the lock through replacement so parallel installers cannot validate against a stale baseline.
exec 9>"$app_dir/.T3-Code-Personal.install.lock"
flock -n 9 || { echo "Another personal T3 install is running." >&2; exit 1; }
temporary_app="$(mktemp "$app_dir/.T3-Code-Personal.XXXXXXXX")"
trap 'rm -f "$temporary_app"' EXIT
cp "$artifact" "$temporary_app"
chmod 755 "$temporary_app"
[[ "$(sha256sum "$artifact" | cut -d' ' -f1)" = "$(sha256sum "$temporary_app" | cut -d' ' -f1)" ]]
node "$repo_dir/scripts/personal-install-guard.ts" "$repo_dir" "$temporary_app" "$app_path"
if [[ -e "$app_path" ]]; then
  cp -p "$app_path" "$app_path.backup-$(date +%Y%m%d-%H%M%S)"
fi
mv "$temporary_app" "$app_path"
cp "$repo_dir/assets/prod/black-universal-1024.png" "$icon_dir/t3-code-personal.png"
cat > "$applications_dir/t3-code-personal.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=T3 Code Personal
Comment=Personal T3 Code fork with the Codex interface
Exec="$app_path" %U
Icon=$icon_dir/t3-code-personal.png
Terminal=false
Categories=Development;
StartupWMClass=t3code-personal
StartupNotify=true
DESKTOP
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$applications_dir/t3-code-personal.desktop"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir"
fi
printf 'Installed %s\nLaunch T3 Code Personal from your application menu.\n' "$app_path"
