# Minke application updates

Packaged macOS, Windows, and Linux builds can check for stable Minke releases. Updating always requires an explicit installation step: Minke never replaces the running application and never silently launches an installer.

## Check and download an update

- Minke checks shortly after startup and then once every 24 hours.
- **About Minke → Check for updates** runs a check immediately.
- **Settings → Minke → Preferences → Software updates** contains **Download updates automatically**. It is enabled by default.
- When automatic downloads are enabled, Minke downloads and verifies a new installer in the background, then asks before opening or revealing it.
- When automatic downloads are disabled, select **Download update** before any installer is downloaded.

Unsupported platforms and architectures do not receive an installer.

## Install the downloaded update

| Platform | Release asset | What to do |
| --- | --- | --- |
| macOS `arm64` / `x64` | `Minke-macos-{arch}.dmg` | Open the DMG, quit Minke, and copy the app into Applications |
| Windows `x64` | `Minke-windows-x64.exe` | Review the Windows prompt and launch the installer |
| Debian-family Linux `x64` | `Minke-linux-x64.deb` | Open the system package installer |
| RPM-family Linux `x64` | `Minke-linux-x64.rpm` | Open the system package installer |
| Other Linux / current AppImage `x64` | `Minke-linux-x64.AppImage` | Quit Minke and manually replace the previous AppImage with the revealed file |

## Unsigned build prompts

### macOS

Current builds are unsigned and unnotarized, so Gatekeeper may block the app. Review the warning and prefer **Open Anyway** under **System Settings → Privacy & Security**.

Removing quarantine manually bypasses a macOS security check. Use it only as a last-resort decision for the exact `/Applications/Minke.app` downloaded from the official Releases page. Minke never removes quarantine automatically.

### Windows

The EXE is not code-signed yet. Windows can show an unknown-publisher or SmartScreen warning. Review the prompt and explicitly choose whether to continue.

### Linux

DEB and RPM files open with the system package installer, which may request administrator authorization. AppImage has no universal installer; Minke reveals the verified executable for manual replacement.
