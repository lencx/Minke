<p align="center">
  <img src="./resources/icons/icon.png" width="112" alt="Minke 图标">
</p>

<h1 align="center">Minke</h1>

<p align="center">
  <strong>为 DeepSeek Harness 打造的原生桌面工作空间</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="https://github.com/lencx/Minke/releases"><img src="https://img.shields.io/github/downloads/lencx/Minke/total.svg?style=flat" alt="Minke downloads"></a>
  <a href="https://discord.gg/XMX5BEX8K"><img src="https://img.shields.io/badge/Minke-discord-blue?style=flat&logo=discord&logoColor=f2f0ea" alt="Minke Discord"></a>
  <a href="https://x.com/lencx_"><img src="https://img.shields.io/twitter/url?url=https%3A%2F%2Fx.com%2Flencx_" alt="在 X 上关注 @lencx_"></a>
  <a href="https://www.buymeacoffee.com/lencx"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="请我喝杯咖啡" height="20"></a>
</p>

Minke 在本地运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，将它带入一个专注、本地优先的智能体桌面工作空间。对话、项目文件、终端、网页工具和原生桌面操作始终触手可及，无需在多个应用之间切换，让工作流保持完整。

> [!IMPORTANT]
> Minke 正在持续开发中，功能、打包方式和本地数据结构可能随项目迭代发生变化。Minke 是独立的社区项目，并非 DeepSeek 官方产品。

## 核心亮点

- **不只是对话窗口** — 彼此独立的右侧和底部 Tabs，将文件管理器、终端、浏览器、插件和 Session 详情放在当前对话旁边。插件区支持从 GitHub 发现插件，以及安装、状态检查、修复与卸载。文件管理器支持目录浏览、语法高亮预览、编辑与 Diff；终端则连接运行 Minke 的电脑上的真实 PTY。
- **真正的远程工作空间，而非桌面投影** — Minke Host 将受支持的桌面能力投射到响应式 Web UI。你可以在手机或平板上继续对话、启动智能体任务、管理项目文件和使用宿主机终端，不需要传输 Electron 窗口的像素画面。
- **可安装的 PWA** — 通过安全的 HTTPS 地址打开 Minke，即可安装到主屏幕并以独立应用模式启动。PWA 提供完整品牌启动界面和更及时的连接状态反馈，同时不会缓存已认证的工作空间内容。
- **私有远程访问** — Minke 可以通过由应用管理的远程链路提供响应式工作空间。目前完成验证的是 Tailscale Serve HTTPS；Tailscale Direct IP 与 Cloudflare Access 在完成发布测试前仍属于实验性接入。
- **本地模型集成** — Minke 可以发现并连接 LM Studio、Ollama，以及其他仅监听本机回环地址的 OpenAI 兼容服务。可选的生命周期管理能够按需启动受支持的本地运行时，同时不会接管原本已经运行的服务。
- **键盘优先的高效操作** — 全局命令面板（`Mod+K`）、可配置快捷键、原生菜单、Session 历史导航与日志导出、主题同步和中英文界面，让常用操作始终触手可及。
- **安全、可恢复的数据迁移** — 自定义 Minke 数据目录，预览并合并现有 Session、插件与设置。Minke 会去重相同文件、保留冲突和源目录，并只在重启迁移成功后切换；也可以选择从全新数据目录开始。
- **本地优先并覆盖三大平台** — 应用状态和浏览器会话数据保留在本机的 Minke 数据边界内。自动化发布覆盖 macOS、Windows 和 Linux，并提供便携的 AppImage。

![Minke 代码工作区：文件 Diff 与终端](./assets/code.png)

## 通过 Tailscale 在手机上访问

Minke 的远程访问是由 Minke Host 支撑的响应式 Web 客户端，并不是 Electron
窗口的视频流或触控投影。你可以在手机上继续对话、启动智能体任务、管理项目文件，
并使用实际运行在 Minke 电脑上的终端。

![Minke 在手机与桌面上的远程工作空间](./assets/minke-remote.gif)

> [!NOTE]
> 当前唯一完成端到端实测的远程链路是 **Tailscale Serve HTTPS**。
> Tailscale Direct IP 和 Cloudflare Access 虽已提供高级接入能力，但尚未完成
> 发布验证，目前请视为实验性功能。

Minke 可以通过 [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
私密地提供响应式 Web 界面。Harness 仍然只监听本机回环地址，不会暴露到
局域网，也不会启用公开的 Tailscale Funnel。

1. 在运行 Minke 的电脑和手机上安装 Tailscale，登录同一个 tailnet，并确认电脑已连接。
2. 打开 Minke 的 **设置 → 远程访问**，启用 **通过 Tailscale 访问**，然后完全退出并重新启动 Minke。
3. 回到 **远程访问**，在手机上打开界面显示的 `https://…ts.net` 地址。

### 安装为 PWA

通过 Tailscale HTTPS 地址打开远程页面，点击侧边栏中的 **安装 Minke**，并接受
浏览器的安装提示。在 iPhone 或 iPad 上，请使用 **分享 → 添加到主屏幕**。
安装后会以独立应用模式启动；网络较差时会展示连接中或离线状态，而不是静默展示
缓存的工作空间内容。

Minke 只在应用运行期间持有前台代理，并会在退出时停止。远程页面能够启动
智能体任务，并使用 Minke 已授权的本机工具，因此请只允许可信的 tailnet 成员
访问。

## 安装

请仅从 Minke 官方 [GitHub Releases](https://github.com/lencx/Minke/releases) 页面下载安装包。

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Apple Silicon（`arm64`） | `.dmg` |
| macOS | Intel（`x64`） | `.dmg` |
| Windows | `x64` | `.exe` |
| Linux | Debian / Ubuntu（`x64`） | `.deb` |
| Linux | Fedora / RHEL（`x64`） | `.rpm` |
| Linux | 便携版（`x64`） | `.AppImage` |

### macOS

1. 下载并打开 `.dmg` 文件。
2. 将 `Minke.app` 拖入“应用程序”目录。
3. 当前预发布版本尚未经过 Apple 公证。打开“终端”，移除已安装应用的 quarantine 属性：

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Minke.app"
   ```

4. 从“应用程序”目录打开 Minke。

> [!CAUTION]
> 移除 quarantine 属性会绕过一项 macOS 安全检查。请仅对从官方 Releases 页面下载的 `Minke.app` 执行上述命令，不要将命令中的路径替换为宽泛目录。也可以尝试在 **系统设置 → 隐私与安全性** 中使用 Apple 提供的[“仍要打开”](https://support.apple.com/zh-cn/102445)流程。

### Windows

1. 下载 Windows x64 `.exe` 安装程序。
2. 运行安装程序，并按照界面提示完成安装。
3. 新发布的预览版本可能触发 Windows 信誉安全提示。请先确认安装程序来自 Minke 官方 Releases 页面，再决定是否继续。

### Linux

根据发行版下载对应安装包，可以通过图形化软件管理器打开，也可以在终端中安装。

Debian / Ubuntu：

```bash
sudo apt install "/path/to/minke-package.deb"
```

Fedora / RHEL：

```bash
sudo dnf install "/path/to/minke-package.rpm"
```

请将示例路径替换为实际下载的安装包路径。

## 从源码构建

请在与目标安装包相同的操作系统和 CPU 架构上构建 Minke。构建产物位于 `out/make`，本项目不支持在单一宿主机上进行跨平台打包。

环境依赖：

- 支持 submodule 的 Git，并确保已检出 `vendor/deepseek-harness` 子模块。
- Node.js 24 或更高版本。
- pnpm 11.7.0；执行脚本前需已安装仓库依赖。
- macOS：Apple Silicon 或 Intel Mac，并安装 Xcode Command Line Tools；`.dmg` 只能在 macOS 上构建。
- Windows：Windows x64；如果原生依赖需要在本地编译，可能还需要安装 Visual Studio 2022 Build Tools，并选择 **Desktop development with C++** 工作负载。
- Linux：Linux x64，并安装原生编译工具链、`fakeroot`、`dpkg`，以及 `rpm` 或 `rpm-build`。

首次检出源码并安装仓库依赖后，先准备 Harness runtime：

```bash
pnpm run harness:stage
```

该命令会安装并构建项目固定版本的 DeepSeek Harness 源码，然后将可复用的桌面 runtime 生成到 `runtime/host`。首次检出源码，或固定的 Harness 源码及 runtime 契约发生变化后，需要执行一次。

使用开发模式启动 Minke：

```bash
pnpm start
```

`pnpm start` 会刷新已准备 runtime 中的 Minke 集成，并启动开发应用。

为当前平台生成安装包：

```bash
pnpm make
```

`pnpm make` 会先重新执行一次完整的 runtime 准备流程，再将当前平台的安装包生成到 `out/make`。
