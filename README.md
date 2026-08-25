<p align="center">
  <img src="./resources/icons/icon.png" width="112" alt="Minke icon">
</p>

<h1 align="center">Minke</h1>

<p align="center">
  <strong>A native desktop workspace for DeepSeek Harness</strong>
</p>

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/lencx/Minke/releases"><img src="https://img.shields.io/github/downloads/lencx/Minke/total.svg?style=flat" alt="Minke downloads"></a>
  <a href="https://discord.gg/XMX5BEX8K"><img src="https://img.shields.io/badge/Minke-discord-blue?style=flat&logo=discord&logoColor=f2f0ea" alt="Minke Discord"></a>
  <a href="https://x.com/lencx_"><img src="https://img.shields.io/twitter/url?url=https%3A%2F%2Fx.com%2Flencx_" alt="Follow @lencx_ on X"></a>
  <a href="https://www.buymeacoffee.com/lencx"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" height="20"></a>
</p>

Minke brings [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) to the desktop as a focused, local-first workspace for agentic work. Conversations, project files, terminals, web tools, and native desktop actions stay within reach—without fragmenting your workflow across multiple apps.

> [!IMPORTANT]
> Minke is under active development. Features, packaging, and the local data schema may change as the project evolves. Minke is an independent community project, not an official DeepSeek product.

## Highlights

- **More than a chat window** — Independent right and bottom Tabs keep Files, Terminal, Browser, Plugins, and Session details beside the active conversation. The Plugins workspace supports GitHub discovery, installation, status checks, repair, and removal. Files supports navigation, syntax-highlighted previews, editing, and diffs, while Terminal connects to a real PTY on the Minke host.
- **A real remote workspace, not screen sharing** — Minke Host projects supported desktop capabilities into a responsive Web UI. From a phone or tablet you can continue conversations, start agent tasks, work with project files, and use the host terminal without streaming pixels from the Electron window.
- **Installable as a PWA** — Open Minke through a secure HTTPS address and install it to the home screen for a standalone, app-like experience. The PWA provides branded launch surfaces and early connection feedback, while deliberately avoiding caches of authenticated workspace traffic.
- **Private remote access** — Minke can expose its responsive workspace through an application-managed remote route. The currently validated path is Tailscale Serve over HTTPS; Tailscale Direct IP and Cloudflare Access integrations remain experimental until they complete release testing.
- **Local model integrations** — Minke can discover and connect to LM Studio, Ollama, and other loopback OpenAI-compatible services. Optional lifecycle management can start supported local runtimes when needed without taking ownership of services that were already running.
- **Fast keyboard-driven control** — The global Command Palette (`Mod+K`), configurable shortcuts, native menus, Session history navigation, log export, synchronized themes, and English and Chinese UI keep common actions close at hand.
- **Safe, recoverable data migration** — Choose where Minke stores its data, then preview and merge existing Sessions, plugins, and settings. Minke deduplicates identical files, preserves conflicts and source directories, and switches only after the restart-time migration succeeds; starting with a clean data home remains an option.
- **Local-first and cross-platform** — Application state and browser session data stay on your machine under the Minke data boundary. Automated releases target macOS, Windows, and Linux, including a portable AppImage.

<table>
  <tr>
    <td width="50%"><img src="./assets/01.png" alt="Minke conversation workspace"></td>
    <td width="50%"><img src="./assets/02.png" alt="Minke settings and workspace"></td>
  </tr>
  <tr>
    <td width="50%"><img src="./assets/code.png" alt="Minke code workspace with Files diff and Terminal"></td>
    <td width="50%"><img src="./assets/plugin.png" alt="Minke Plugins workspace and tab layout"></td>
  </tr>
</table>

## Mobile access with Tailscale

Minke remote access is a responsive Web client backed by Minke Host—not a
video stream or touch-controlled projection of the Electron window. From a
phone you can continue conversations, start agent tasks, manage project files,
and use a terminal that runs on the Minke computer.

![Minke remote workspace on mobile and desktop](./assets/minke-remote.gif)

> [!NOTE]
> The only remote route currently tested end to end is **Tailscale Serve over
> HTTPS**. Tailscale Direct IP and Cloudflare Access are available as advanced
> integrations, but have not yet completed release validation and should be
> treated as experimental.

Minke can expose its Web UI privately through
[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).
It keeps Harness on the local loopback address, does not bind it to the LAN,
and does not enable the public Tailscale Funnel.

1. Install Tailscale on the Minke computer and the phone, sign both into the
   same tailnet, and confirm the computer is connected.
2. In Minke, open **Connections → Device access → Remote access**, then enable
   **Access through Tailscale**. Minke connects in the background; no restart
   is required.
3. Copy or open the displayed
   `https://…ts.net` address on the phone.

### Install as a PWA

Open the Tailscale HTTPS address, choose **Install Minke** in the sidebar,
and accept the browser install prompt. On iPhone or iPad, use
**Share → Add to Home Screen**. The installed app launches in standalone mode;
when connectivity is poor it shows connection or offline feedback instead of
silently presenting cached workspace content.

Minke owns a foreground Serve session and stops it when the app exits. The
remote page can start agent tasks and use local tools already authorized in
Minke, so grant tailnet access only to people you trust.

## Installation

Download Minke only from the official [GitHub Releases](https://github.com/lencx/Minke/releases) page. The links below always point to the latest stable release.

| Platform | Architecture | Package |
| --- | --- | --- |
| macOS | Apple Silicon (`arm64`) | [Download `.dmg`](https://github.com/lencx/Minke/releases/latest/download/Minke-macos-arm64.dmg) |
| macOS | Intel (`x64`) | [Download `.dmg`](https://github.com/lencx/Minke/releases/latest/download/Minke-macos-x64.dmg) |
| Windows | `x64` | [Download `.exe`](https://github.com/lencx/Minke/releases/latest/download/Minke-windows-x64.exe) |
| Linux | Debian / Ubuntu (`x64`) | [Download `.deb`](https://github.com/lencx/Minke/releases/latest/download/Minke-linux-x64.deb) |
| Linux | Fedora / RHEL (`x64`) | [Download `.rpm`](https://github.com/lencx/Minke/releases/latest/download/Minke-linux-x64.rpm) |
| Linux | Any distro (portable) | [Download `.AppImage`](https://github.com/lencx/Minke/releases/latest/download/Minke-linux-x64.AppImage) |

Release checksums are available in [`SHA256SUMS`](https://github.com/lencx/Minke/releases/latest/download/SHA256SUMS).

Packaged macOS, Windows, and Linux builds check for stable updates
automatically. Minke selects the fixed DMG, EXE, DEB, RPM, or AppImage asset
for the running system, verifies the immutable GitHub Release, URL chain,
exact size, SHA-256 digest, and available OS provenance marker, then asks
before opening it. Disable background downloads under
**Settings → Minke → Preferences → Application updates** to require a
**Download update** confirmation first, or use **About Minke → Check for
updates** at any time. Installation always remains explicit. See
[desktop application updates](./docs/app-updates.md) for the user flow and
platform behavior.

### macOS

1. Download the `.dmg` file and open it.
2. Drag `Minke.app` into the Applications folder.
3. Current pre-release builds are not notarized. First try Apple's [Open Anyway](https://support.apple.com/en-us/102445) flow under **System Settings → Privacy & Security**.
4. If you explicitly accept the risk and the system flow is unavailable, remove quarantine only from the exact installed app:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Minke.app"
   ```

5. Open Minke from the Applications folder.

> [!CAUTION]
> Removing the quarantine attribute bypasses a macOS security check. Minke's updater never runs this command automatically. Use it only as a last resort for `Minke.app` downloaded from the official Releases page, and never replace the path with a broad directory.

### Windows

1. Download the Windows x64 `.exe` installer.
2. Run the installer and follow the on-screen instructions.
3. Windows may show a reputation-based warning for a new pre-release build. Continue only after confirming that the installer came from the official Minke Releases page.

### Linux

Download the package for your distribution, then open it with your graphical package manager or install it from a terminal.

Debian / Ubuntu:

```bash
sudo apt install "/path/to/minke-package.deb"
```

Fedora / RHEL:

```bash
sudo dnf install "/path/to/minke-package.rpm"
```

Replace the example path with the downloaded package path.

## Build from source

Build Minke on the same operating system and CPU architecture as the package you need. The build produces distributables for the current host under `out/make`; this project does not support cross-platform packaging from a single host.

Prerequisites:

- Git with submodule support. The `vendor/deepseek-harness` submodule must be checked out.
- Node.js 24 or newer.
- pnpm 11.7.0, with the repository dependencies installed before running the scripts.
- macOS: an Apple Silicon or Intel Mac with Xcode Command Line Tools. The `.dmg` target can only be built on macOS.
- Windows: a Windows x64 host. Visual Studio 2022 Build Tools with the **Desktop development with C++** workload may be needed if a native dependency must be compiled locally.
- Linux: a Linux x64 host with a native build toolchain, `fakeroot`, `dpkg`, and either `rpm` or `rpm-build`.

On a fresh checkout, first install the repository dependencies, then prepare the Harness runtime:

```bash
pnpm run harness:stage
```

This command installs and builds the pinned DeepSeek Harness source, then stages the reusable desktop runtime under `runtime/host`. Run it after a fresh checkout, or whenever the pinned Harness source or runtime contract changes.

Start Minke in development mode with:

```bash
pnpm start
```

`pnpm start` refreshes the Minke integration in the prepared runtime and launches the development app.

Create the distributable package for the current platform with:

```bash
pnpm make
```

`pnpm make` performs a full runtime stage again before writing the platform package to `out/make`.

## 中国用户

如在使用中遇到问题，或希望进一步交流 Minke，可关注公众号「浮之静」，发送 `dsh` 获取进群码。也欢迎大家贡献 PR 或分享给更多朋友，您的每一次 Star 都是对开源项目的巨大支持，感恩。

<p>
  <img width="150" alt="qrcode" src="https://github.com/user-attachments/assets/f7194e28-a290-444f-89a2-9f656c59e218" />
  <img width="172" src="https://user-images.githubusercontent.com/16164244/207228300-ea5c4688-c916-4c55-a8c3-7f862888f351.png" alt="浮之静公众号">
  <img width="200" src="https://user-images.githubusercontent.com/16164244/207228025-117b5f77-c5d2-48c2-a070-774b7a1596f2.png" alt="Minke 用户交流群">
</p>
