#!/bin/bash
set -euo pipefail

export PATH=/usr/bin:/bin:/usr/sbin:/sbin

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Orca Storm updater requires macOS' >&2
  exit 1
fi

if [[ "${1:-}" != --locked ]]; then
  lock_dir="$HOME/Library/Application Support/Orca Storm"
  mkdir -p "$lock_dir"
  exec lockf -k -t 0 "$lock_dir/update.lock" /bin/bash "$0" --locked
fi

if [[ "${ORCA_STORM_UPDATE_APP_PATH:-}" != '' ]]; then
  app_path=$ORCA_STORM_UPDATE_APP_PATH
elif [[ ( -d "$HOME/Applications/Orca Storm.app" || -d "$HOME/Applications/.Orca Storm.updater-backup" ) && ( -d '/Applications/Orca Storm.app' || -d '/Applications/.Orca Storm.updater-backup' ) ]]; then
  echo 'Two Orca Storm installations found; set ORCA_STORM_UPDATE_APP_PATH' >&2
  exit 1
elif [[ -d "$HOME/Applications/Orca Storm.app" || -d "$HOME/Applications/.Orca Storm.updater-backup" ]]; then
  app_path="$HOME/Applications/Orca Storm.app"
elif [[ -d '/Applications/Orca Storm.app' || -d '/Applications/.Orca Storm.updater-backup' ]]; then
  app_path='/Applications/Orca Storm.app'
else
  echo 'Install Orca Storm once from the DMG before enabling updates'
  exit 0
fi

app_parent=$(dirname "$app_path")
backup_path="$app_parent/.Orca Storm.updater-backup"
if [[ ! -d "$app_path" && -d "$backup_path" ]]; then
  mv "$backup_path" "$app_path"
fi
if [[ ! -d "$app_path" || ! -w "$app_parent" ]]; then
  echo "Orca Storm is missing or $app_parent is not writable" >&2
  exit 1
fi

info_plist="$app_path/Contents/Info.plist"
bundle_id=$(plutil -extract CFBundleIdentifier raw -o - "$info_plist")
if [[ "$bundle_id" != com.ivanbrrr.orcastorm ]]; then
  echo "Unexpected app bundle ID: $bundle_id" >&2
  exit 1
fi
installed_version=$(plutil -extract CFBundleShortVersionString raw -o - "$info_plist")

if pgrep -f "$app_path/Contents/" >/dev/null; then
  echo 'Orca Storm is running; update deferred'
  exit 0
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/orca-storm-update.XXXXXX")
stage_dir=''
mounted=0
cleanup() {
  if [[ "$mounted" == 1 ]]; then
    hdiutil detach "$work_dir/mount" -quiet >/dev/null 2>&1 || true
  fi
  if [[ ! -d "$app_path" && -d "$backup_path" ]]; then
    mv "$backup_path" "$app_path"
  fi
  if [[ -n "$stage_dir" ]]; then
    rm -rf "$stage_dir"
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 \
  --max-time 60 --header 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/IvanBrrr/orca-storm/releases/latest' \
  --output "$work_dir/release.json"
tag=$(plutil -extract tag_name raw -o - "$work_dir/release.json")
if [[ "$tag" == "v$installed_version" ]]; then
  echo "Orca Storm $installed_version is current"
  exit 0
fi
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-storm\.[0-9]+$ ]]; then
  echo "Unexpected release tag: $tag" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) asset_name='orca-storm-macos-arm64.dmg' ;;
  x86_64) asset_name='orca-storm-macos-x64.dmg' ;;
  *) echo 'Unsupported Mac architecture' >&2; exit 1 ;;
esac

digest=''
for ((index = 0; index < 100; index++)); do
  name=$(plutil -extract "assets.$index.name" raw -o - "$work_dir/release.json" 2>/dev/null) || break
  if [[ "$name" == "$asset_name" ]]; then
    digest=$(plutil -extract "assets.$index.digest" raw -o - "$work_dir/release.json")
    break
  fi
done
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Release $tag has no valid SHA-256 for $asset_name" >&2
  exit 1
fi

url="https://github.com/IvanBrrr/orca-storm/releases/download/$tag/$asset_name"
curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 \
  --max-time 1800 "$url" --output "$work_dir/app.dmg"
actual_digest=$(shasum -a 256 "$work_dir/app.dmg")
actual_digest=${actual_digest%% *}
if [[ "$actual_digest" != "${digest#sha256:}" ]]; then
  echo "SHA-256 mismatch for $asset_name" >&2
  exit 1
fi

mkdir "$work_dir/mount"
hdiutil attach "$work_dir/app.dmg" -readonly -nobrowse \
  -mountpoint "$work_dir/mount" >/dev/null
mounted=1
stage_dir=$(mktemp -d "$app_parent/.orca-storm-stage.XXXXXX")
ditto "$work_dir/mount/Orca Storm.app" "$stage_dir/Orca Storm.app"
staged_info="$stage_dir/Orca Storm.app/Contents/Info.plist"
staged_id=$(plutil -extract CFBundleIdentifier raw -o - "$staged_info")
staged_version=$(plutil -extract CFBundleShortVersionString raw -o - "$staged_info")
if [[ "$staged_id" != com.ivanbrrr.orcastorm || "v$staged_version" != "$tag" ]]; then
  echo 'Downloaded app identity does not match the release' >&2
  exit 1
fi
if pgrep -f "$app_path/Contents/" >/dev/null; then
  echo 'Orca Storm started during download; update deferred'
  exit 0
fi

rm -rf "$backup_path"
mv "$app_path" "$backup_path"
mv "$stage_dir/Orca Storm.app" "$app_path"
echo "Updated Orca Storm from $installed_version to $staged_version"
