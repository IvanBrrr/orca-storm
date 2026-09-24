#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Orca Storm updater requires macOS' >&2
  exit 1
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
support_dir="$HOME/Library/Application Support/Orca Storm"
agent_dir="$HOME/Library/LaunchAgents"
agent_path="$agent_dir/com.ivanbrrr.orcastorm.updater.plist"
installed_script="$support_dir/update-storm-macos.sh"
agent_label=com.ivanbrrr.orcastorm.updater
agent_domain="gui/$(id -u)"

if [[ "${1:-}" == --uninstall ]]; then
  launchctl bootout "$agent_domain" "$agent_path" >/dev/null 2>&1 || true
  rm -f "$agent_path" "$installed_script"
  echo 'Orca Storm scheduled updater removed'
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo 'Usage: install-storm-macos-updater.sh [--uninstall]' >&2
  exit 1
fi

mkdir -p "$support_dir" "$agent_dir"
install -m 700 "$script_dir/update-storm-macos.sh" "$installed_script"
escaped_script=${installed_script//&/&amp;}
escaped_script=${escaped_script//</&lt;}
escaped_script=${escaped_script//>/&gt;}
escaped_log=${support_dir//&/&amp;}
escaped_log=${escaped_log//</&lt;}
escaped_log=${escaped_log//>/&gt;}

cat > "$agent_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$agent_label</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$escaped_script</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$escaped_log/updater.log</string>
  <key>StandardErrorPath</key><string>$escaped_log/updater-error.log</string>
</dict>
</plist>
EOF
plutil -lint "$agent_path" >/dev/null
launchctl bootout "$agent_domain" "$agent_path" >/dev/null 2>&1 || true
launchctl bootstrap "$agent_domain" "$agent_path"
echo "Orca Storm updater installed: $agent_path"
