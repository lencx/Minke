# Desktop application updates

Minke uses a custom installer-download flow in packaged desktop builds because
the available macOS application is not signed. The same trust policy and user
controls apply on macOS, Windows, and Linux. The updater never replaces the
running application and never silently launches an installer.

## User flow

- Minke checks for a stable update shortly after startup and then once every
  24 hours.
- **About Minke → Check for updates** runs a check immediately, independently
  of the automatic schedule.
- **Settings → Personal preferences → Application updates** contains
  **Download updates automatically**. It is enabled by default and can be
  disabled.
- With automatic downloads enabled, Minke downloads and verifies a trusted new
  installer in the background, but still asks before opening or revealing it.
- With automatic downloads disabled, Minke reports the new version and waits
  for **Download update** before any installer bytes are downloaded.
- Installation remains explicit and platform-native:

  | Platform | Release asset | Final action |
  | --- | --- | --- |
  | macOS `arm64`/`x64` | `Minke-macos-{arch}.dmg` | Open the DMG; quit Minke and copy the app into Applications |
  | Windows `x64` | `Minke-windows-x64.exe` | Launch the Windows installer |
  | Debian-family Linux `x64` | `Minke-linux-x64.deb` | Open the system package installer |
  | RPM-family Linux `x64` | `Minke-linux-x64.rpm` | Open the system package installer |
  | Other Linux / current AppImage `x64` | `Minke-linux-x64.AppImage` | Reveal the verified executable for manual replacement |

Unsupported platforms and architectures do not receive an installer.

## Trust and verification

The updater fails closed unless all applicable checks pass:

1. Release metadata comes from the fixed
   `api.github.com/repos/lencx/Minke/releases/latest` endpoint over HTTPS.
2. The release is stable, newer than the running version, and marked
   `immutable` by GitHub.
3. The release contains exactly one fixed-name asset for the detected target.
4. The asset URL is exactly under the `lencx/Minke` GitHub release path.
5. Chromium's redirect chain stays on HTTPS GitHub release-asset hosts.
6. The downloaded object is a regular file, not a symbolic link, with the
   exact declared size and SHA-256 digest returned by the GitHub Releases API.
7. The same file, digest, and platform provenance checks run again immediately
   before the installer is handed to the operating system.

The current trust root is control of the `lencx/Minke` GitHub repository plus
GitHub's immutable-release infrastructure. A separately managed update-signing
key would reduce this trust boundary and remains a recommended future
hardening step.

## Platform provenance and unsigned-build limits

### macOS

Chromium must leave `com.apple.quarantine` on the downloaded DMG. Minke checks
the attribute but never runs `xattr -d`, `xattr -dr`, or an equivalent removal.
If the attribute is missing, Minke deletes the private download and offers the
official Release page instead.

The app is still unsigned and unnotarized, so Gatekeeper can block it even
after the updater verifies the release and digest. Prefer reviewing the warning
and using **Open Anyway** under **System Settings → Privacy & Security**.
Removing quarantine manually should remain a last-resort, explicit user
decision for the exact installed `/Applications/Minke.app` path.

### Windows

Chromium must leave the NTFS `Zone.Identifier` alternate data stream with
Internet or Restricted zone (`ZoneId=3` or `ZoneId=4`). Minke verifies and
preserves this Mark-of-the-Web so Windows and SmartScreen can continue to
evaluate the EXE. A missing or local/trusted-zone marker causes the updater to
delete the private download and fall back to the official Release page.

The EXE is not code-signed yet. Windows can therefore show an unknown-publisher
or SmartScreen warning. The user must review it and explicitly continue.

### Linux

Linux distributions do not provide one portable quarantine/provenance marker
that can be required across DEB, RPM, and AppImage. Minke therefore relies on
the fixed immutable Release, URL chain, exact size, SHA-256 digest, private
download directory, and final re-verification.

DEB and RPM files are opened with the system's registered package installer,
which may request administrator authorization. AppImage has no universal
installer: Minke sets only the downloaded file's execute permission and reveals
it in the file manager; the user quits Minke and replaces the old AppImage.

## Release configuration

Release immutability must be enabled once under
**Repository Settings → General → Releases → Enable release immutability**.
The package workflow then:

1. verifies that the tag matches `package.json`;
2. stages the exact six platform assets and `SHA256SUMS`;
3. refuses to modify an existing release;
4. creates a draft and uploads every asset before publishing it; and
5. verifies the published release's `immutable` API field.

If immutability is not enabled, the workflow moves the release back to draft
and fails. Delete that failed draft after enabling immutability, then rerun the
tag workflow.
