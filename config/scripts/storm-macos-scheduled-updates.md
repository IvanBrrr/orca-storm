# Scheduled Orca Storm updates on macOS

Orca Storm can update from this fork's GitHub Releases without an Apple Developer certificate. Install the DMG once, then run this from a checkout of the fork:

```bash
bash config/scripts/install-storm-macos-updater.sh
```

The installer adds a per-user `launchd` agent that checks on login and daily at 10:00 local time. A missed scheduled run fires when the Mac wakes. It updates an existing `~/Applications/Orca Storm.app` or `/Applications/Orca Storm.app` while the app is closed. Use `~/Applications` if your account cannot write to `/Applications`. If both locations contain Orca Storm, remove the duplicate before enabling updates. A file lock prevents overlapping runs. The updater leaves the official Orca app, worktrees, sessions, and settings untouched.

Each run checks the latest release version and downloads the DMG for the Mac's CPU only when a new version exists. Only builds from `main` are published as releases. The updater compares the download with the SHA-256 digest recorded by GitHub, checks the bundle ID and version, then swaps the app bundle. The previous bundle remains in `.Orca Storm.updater-backup` beside the installed app until the next update. A failed swap restores it. An open app defers the update until a later run.

Run a check immediately with:

```bash
bash "$HOME/Library/Application Support/Orca Storm/update-storm-macos.sh"
```

Logs are in `~/Library/Application Support/Orca Storm/updater.log` and `updater-error.log`. To remove the scheduled job:

```bash
bash config/scripts/install-storm-macos-updater.sh --uninstall
```

This method trusts whoever can publish to this fork's GitHub Releases; the GitHub digest detects a damaged download, but it is not an Apple Developer signature. macOS may ask you to approve an unsigned app after an update, and privacy permissions can need to be granted again. The updater does not remove quarantine flags or change Gatekeeper settings. Apple Developer signing and notarization remain the path to updates without those interruptions.
