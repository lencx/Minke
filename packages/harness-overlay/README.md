# Minke Harness overlay

This package is Minke's product-owned extension layer for DeepSeek Harness. It is installed into the generated desktop runtime and composed through the public `--patch` bundle seam. Nothing in this package is copied into or applied over `vendor/deepseek-harness`.

Harness development dependencies resolve through workspace overrides to the pinned source checkout. `pnpm harness:stage` installs and builds that checkout before typechecking or runtime tests, so source upgrades do not depend on matching npm packages being published first.

The host composition mounts the separate `@lencx/minke-model-runtime/dsh` adapter:

- `model-runtime` is a DSH plugin that owns local model discovery and optional service lifecycle for exactly two product runtimes: LM Studio and Ollama. LM Studio uses `lms server status --json` / `lms server start` and enriches its OpenAI-compatible catalog with LM Studio's v1 loaded-instance metadata. Before dispatch, it verifies that the selected instance has the configured context window. Selecting an unloaded model explicitly authorizes Minke to load that model with the configured context, even when LM Studio was started externally; Minke still never unloads or reconfigures an existing external instance. If Minke started the service itself, it may also reload an undersized default model instance while preserving its supported load parameters. Ollama uses its OpenAI-compatible `/v1/models` endpoint and starts through `ollama serve`. A generic `openAICompatible` adapter remains available for manually configured loopback servers; it does not gain command discovery or process management.

Product subagents follow the pinned DSH Profile Bundle contract. Install and enable Codex or Claude Code in **Plugins → Official**, using the version offered by the running DSH release. The `web` Profile also supports CLI installation.

- Codex: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex`
- Claude Code: `dsh plugin --profile web add @deepseek-ai/dsh-subagent-claude-code`

Follow any restart prompt after installation or update. Enabled bundles contribute their delegation tools globally, including to Minimal presets; no copied preset or extra tool row is required. Existing preset-local tools shadow the global contribution, so remove obsolete duplicate rows. The Bundle owns its pinned platform CLI, provider configuration, and private runtime closure.

The model runtime executes CLIs through `ctx.subprocess`, resolves credential references through `ctx.credentials`, and mounts the upstream `@deepseek-ai/dsh-llm-pi-ai` plugin before discovering local services in parallel. Cloud routes remain available during local startup and auto-start updates. Discovered provider metadata is only the composition base layer; it is never serialized to `settings.yaml`, and user model settings continue to override it. Secrets are resolved for discovery but never copied into provider profiles.

The independent `@lencx/minke-harness-overlay/web-search` Host entry registers
the credential-free `minke_web_search` model tool. DSH selects the native
`web_search` provider by model route. Minke configures `web_fetch` to use the
DeepSeek Fetch API and disables the local HTTP provider.
The persisted `webSearch.fallbackEnabled` compatibility setting defaults to
`true`; Harness startup maps it to the product-owned
`MINKE_WEB_SEARCH_FALLBACK_ENABLED` launch flag and uses it only to enable or
disable this additional tool. Agents call it explicitly; Minke does not intercept
`tools/execute`, retry native failures, or replace their results. Search snippets
are never presented as fetched page content. The built-in Bing RSS endpoint is a bounded
best-effort search route with no stability guarantee.
`MINKE_WEB_SEARCH_BASE_URL` may select a compatible RSS endpoint. The provider
sends no cookies or credentials, follows only same-origin or controlled Bing
country redirects, rejects HTML/challenge responses, and caps response,
title, snippet, URL, result-count, query-count, and time budgets. The tool is
available to full Agent Presets and withheld from `minimal`.

Service policy is explicit:

- `external` only discovers an already-running service;
- `ensure-running` starts a missing service. LM Studio's one-shot CLI leaves the shared service running; an `ollama serve` process started by Minke is owned by the Harness process and stopped with it;
- `managed` stops the service on plugin disposal only when this plugin proved it started that service.

Both auto-start preferences default to `false` under `modelRuntime.{lmStudio,ollama}.enabled` in `~/.minke/desktop/minke.config.json`. Electron checks known installation paths and `PATH` without executing either CLI. The DSH Models page shows both LM Studio and Ollama auto-start switches in one labeled Local services section through its public `settings.models.footer` slot. Both controls remain available independently of provider discovery; native provider cards keep their standard configuration layout. Service availability describes the local command, not the number of models in its catalog. No translated-heading lookup, private form mutation, or document-wide observer is involved. An unavailable local command leaves its switch visible but disabled. Auto-start changes reconcile against the running Harness immediately and persist only after its provider registry acknowledges the update. Turning off auto-start does not kill an Ollama server Minke already started for the current Harness; it remains usable until Harness exits, while every later Harness launch honors the disabled preference. `LM_STUDIO_BASE_URL` and `OLLAMA_BASE_URL` can select explicit loopback endpoints and are also applied to services Minke starts. Without an override, Minke follows the runtimes' official defaults: LM Studio uses `http://127.0.0.1:1234/v1` and Ollama uses `http://127.0.0.1:11434/v1`. Port `0` is rejected because a client Base URL must contain the service's resolved, connectable port. `LM_API_TOKEN` is used for LM Studio when configured.

The browser half owns Minke's product actions and post-boot desktop surface adaptation. Keyboard routing and editing belong to the shared DSH shortcuts service. It uses:

- `settings.onboarding` slot shadowing to bypass Harness's developer-only internal-testing notice without changing the upstream plugin;
- the built-in DSH scheduler and task page, with time context and reminder tools supplied by Agent Presets; the retired Automation tasks bundle needs no enablement;
- Harness's native whole-session turn outline and deep-history jump loader, so unloaded turns remain previewable and navigable without a Minke-owned conversation directory;
- one `settings.section` entry with compact labeled secondary tabs for durable Minke preferences;
- `ctx.uiWorkspace.startSession()` for the New Session action;
- the Settings trigger's accessible DOM contract for the Settings action;
- Harness's `ctx.locale` registry and revision source for synchronized zh/en copy;
- DSH Desktop's `__DSH_LOCALE__` bridge for native language initialization and change notifications, reading the existing preference through `settings/describe`;
- the native `data-ds-theme-source` presenter attribute for window appearance, including system and custom themes;
- DSH Desktop's `__DSH_HOST_PATHS__` bridge for file and folder references; the native composer retains its image and pasted-byte upload rules;
- a lifecycle-managed DOM adapter for the macOS sidebar, titlebar, and translucent surfaces; the adapter is capability-gated by the isolated preload and removes its observer, markers, and stylesheet on disposal;
- the isolated Minke preload bridge for durable desktop-owned preferences.

Third-party Profile plugins cross the trusted extension boundary. Their package manager hooks may execute during installation, and their Host and Client code is composed into the `web` Profile on every later launch. Such code can reach DSH data, workspaces, credentials through DSH services, and any service the user authorizes. Minke therefore treats the plugin source—not only its install command—as a persistent trust decision.

DSH's native Plugins page owns installation, configuration, installed bundles,
and live activation through `pluginManager`. Minke contributes GitHub discovery
and desktop safe-mode recovery through public slots. The former disabled-package
list is migrated once into the `web` Profile's selected bundles before startup;
installed dependencies remain intact. The legacy list is cleared only after the
Profile update succeeds. Ordinary plugin changes no longer use desktop IPC,
CLI subprocesses, or a separate Minke activation state.
Both ordinary DSH Browser and Minke's Persistent Browser use the public
`dshDesktop.browser` acquire/release/open-request protocol. Ordinary Browser
keeps DSH's process-lifetime, workspace-scoped storage. Persistent Browser is the
existing `web` / `minke.web` tab type with an explicit label; its reserved storage
identity maps to the unchanged `persist:minke-tabs-web` partition, retaining
existing sign-ins across restarts. Closing either tab releases its guest; only
the persistent account's cookies and local storage survive. Tab identity and
saved layouts need no migration. Agent Browser retains its separate temporary
sessions and control handoff.

The desktop owns guest admission, permissions, navigation and teardown in one
lease manager. Main-frame Host callers receive single-use, owner-bound leases;
guest creation starts at the approved blank document. Native Browser forwards
popup requests to its source tab. Persistent Browser additionally retains its
trusted link preload, history and annotations. Guest requests cannot reach the
application Host, including WebSocket and localhost aliases.

GitHub discovery is a preset of the shared Persistent Browser renderer, including
its address bar, navigation and error recovery. The dedicated search toolbar,
GitHub CSS injection and decoration lifecycle are retired. Existing discovery
tabs keep their identity and restore their last URL; discovery guests continue
to disallow popups and omit page annotations. Indexed discovery remains owned
by DSH's optional Custom Plugin Market bundle; users enable it in Plugins and
configure their index sources there.
Desktop recovery exposes only settings and safe-mode changes; legacy Profile
migrations remain separate from that interface.

DSH's native workspace directory flow uses the window-owned desktop picker
bridge when available. Requests from guest windows or subframes are rejected;
remote browsers retain DSH's Host chooser or directory-browser flow.

The unified Minke section contains labeled tabs for Preferences, Browser, and Storage. Keyboard shortcuts use the shared editor in DSH General settings; existing Minke bindings migrate on first launch. Model-related configuration remains under the existing DSH Models entry, so users do not need to switch between two settings directories for one task. Remote access configuration lives only in Connections under Device access, alongside its live status and recovery actions. It is backed by the separate `@lencx/minke-remote-access` package, persists a default-off Tailscale opt-in, shows the active private HTTPS URL, and keeps command execution, retries, trusted-host updates, and process lifecycle in the desktop host rather than the browser bundle. Changing the enable switch applies to the running Harness without restarting Minke.

The separate document-start extension remains CSS-only. It exists solely because first-paint transparency and Electron drag regions must be present before Harness initializes; it does not traverse or modify the Harness DOM.

## Right Sidebar tabs

DSH owns the right tab strip, selection,
splits, floats, fullscreen, and native document previews. Minke registers its
Files editor, Web, AgentBrowser, plugin discovery, and Browser History through
`sidebarRightTabs` and the body/title slots. The native Start page offers
Minke's creation cards and shortcut hints through `sidebar.right.tab.guide.entry`,
below the native Workspace files and Terminal cards. DSH owns the Terminal shell
picker and its multiple-instance, cleanup and refresh-recovery lifecycle.
The right-side Terminal shortcut delegates to DSH; there is no duplicate Minke
Terminal card. The bottom panel uses the same DSH terminal view and service.
Both placements use DSH General font preferences and share Minke's line spacing and code palette;
DSH owns PTYs, input/output, reconnects and explicit close. Minke retains only
the bottom layout and its Session-bound tab identities, with independent window
holds so one placement cannot release the other's shells.
Creating a Minke tab replaces Start in the same pane and strip slot. Reopening
an existing tab focuses it and leaves Start available, following DSH. Keyboard
creation shortcuts use the same controllers. The earlier
`minke.launcher` address redirects to the native Start page.
The native add-tab button opens DSH's Start page in the clicked pane. Its public
`sidebar.right.tab.guide.entry` cards create Minke content in that Start tab's
place, even when focus moves to another pane. The private add-menu slot, picker
adapter and direct pane-creation override are retired. The bottom panel retains
its own creation menu.
The Start page shows DSH's compass, native cards and More tools above Minke's
creation cards. Native descriptions appear for up to four entries and remain
owned by the registering plugin's locale.
Start fills the pane's available height and uses its own DSH scroller. Cards
shrink within narrow panes so their text cannot widen the page.
The docked native Sidebar reserves the bottom panel's current height, including
while resizing it, so its content scrolls above that panel. Fullscreen retains
the entire window, and closing the bottom panel restores the docked Sidebar's height.

Custom content rehydrates from per-window session storage before attaching to
the native layout. Refresh restores Web URLs, Files locations and unsaved drafts,
plugin discovery, history, and active AgentBrowser projections. File drafts retain
their original disk version so a later save still detects external changes.
Terminal tabs reconnect to their original DSH shells after a renderer refresh;
webpage form state is not preserved.

The Files editor offers Preview, Source and Diff for Markdown and HTML files.
Preview renders the current draft through DSH's document bodies; changing modes
does not save or discard edits. In preview headers narrower than 280px, one More
menu contains the view modes and the action to open the file's containing folder
in the system file manager. Wider headers retain those direct buttons; Close
remains outside the menu at every width and still guards unsaved drafts.
DSH's native document tabs keep their own viewer menu.
Native code previews use DSH's source scrollport below the Copy banner; the
earlier Minke scrollbar-gutter background compensation is no longer needed.

Blank-session global controls follow DSH's conversation grid column. While the
native Sidebar is open, DSH owns its split, fullscreen, and collapse buttons;
Minke retains Remote and bottom-panel actions in the conversation area and supplies
the opener when a blank session has no native conversation header.

Session export shares DSH's `sessionLogDownload` service across the native header
menu (More actions → Download session log), `/export`, and Minke's command palette.
The palette action follows the service's lifetime and also works in the Web client.
DSH owns preflight, concurrent request deduplication and error state; the former
Minke export IPC and token protocol are retired. Electron only customizes the
native save dialog, reports download failures and reveals the completed ZIP.
The DSH export modal reports preparation, handoff, and failures. The header
menu also offers the native Copy session as Markdown action.

Minke's Remote and panel controls follow DSH's 28px circular buttons and 15px icons. Their icons
share DSH's unrotated outer contour and border weight; Remote status colors its
wireless symbol inside the frame. On macOS,
the native Sidebar's empty tab-strip area also supports window dragging while
tabs, buttons, and open menus remain interactive.

`tabs/native` is the only adapter to the pinned `sidebar-tab-lifecycle.patch`.
It projects DSH layout state into `TabsRuntime`, which retains content payloads
and the existing controller interface. Global Minke instances have stable content
identities and appear in each visited session's layout; native documents remain
session-owned. Closing a Minke instance in any session closes its other seats.
Native close, replacement, and undo check the renderer's close guard before
committing. Undo cannot recreate a disposed PTY or browser instance.

Each custom view has one stable DOM owner outside the transient native seats.
Seats provide viewport geometry; only visible hosts follow it, with clipping for
overlapping native floats. A shared observer coalesces layout, resize and scroll
changes; static tabs do not poll geometry, and finite layout transitions retain
frame-by-frame tracking. Changing tabs, panes, presentation, or sessions does
not reparent the WebView. Native titles, tab context menus, and drag handling remain in DSH.
Opening right-side content from a global panel such as Plugins returns to the current
conversation and waits for DSH's Sidebar to mount; if no conversation exists,
DSH starts one. Existing tabs and editor drafts are retained. The fallback strip
is used only without a connected DSH Sidebar service. The bottom panel retains
its independent Minke implementation.
There is no DOM observer switching between competing right sidebars.

The applied-artifact tests in `tests/native-sidebar-tabs.test.mjs` exercise the
actual DSH store and controller, including a negative control for close guards.
The Electron conversation regression verifies native placement and WebContents
identity with a local model fixture and temporary user data.
`pnpm test:desktop:sidebar` exercises blank-session controls at different widths,
direct tab creation, Web navigation and retained input, live Terminal commands
after returning from Plugins (including after closing Settings), and the file editor's unsaved-close
guard in the production renderer.

Client Sessions can coexist in the main view and sidebar. Minke locates the main
conversation through the catalog's `retainedBy.mainView` count and navigates with
`uiWorkspace.openSession()`. Browser comment drafts borrow only a live retained
Session scope; opening a sidebar Subagent does not redirect the handoff target.

Terminal font preferences migrate once per Data Home into General settings before startup. Existing DSH overrides are retained; legacy sizes outside 10–20px use the nearest boundary. The original desktop values and a migration receipt remain available for recovery. Minke only edits line spacing after migration; Files source editors follow the General code font and size. IM HTML previews use the successful filesystem result’s canonical path, so directory changes cannot redirect a relative path to the original project. Historical relative writes without canonical metadata do not produce a preview.

Portable Files now expose `MinkeWorkspace` as a native Typert Remote service:
`/api/minke/capabilities` takes `{ args: {} }`; `/api/minke/files.diff`,
`files.list`, `files.preview` and `files.write` take `{ args: { request } }` in
Connection's normal RPC envelope. The capability protocol is version 5; the
obsolete `files.nativeOpen` field is removed, and older handshakes are rejected. The old
`/minke/*` channel and its Connection web-server scope patch are retired. DSH
owns authentication, Host/Origin checks, argument dispatch, cancellation and
service withdrawal; Minke retains file request validation and its root boundary.
The source-mode Remote decorators keep the existing esbuild pipeline; method
parameter names are part of the wire contract and must not be minified.

Files system-open actions use `remote.session.canOpenWorkspacePath()` and
`openWorkspacePath({ path }, signal)` for both desktop and browser clients.
The serving Host owns native opening and path mapping verification; Files hides
these actions when that Host lacks the capability. The private Files-open IPC,
preload verb and `FileManagerRuntime.open()` are retired. File browsing, editing,
diffs and disk watchers keep their existing data transports.

Storage uses the same `__DSH_DIRECTORY_PICKER__.pick()` bridge as DSH's workspace
flows. The private Data Home picker IPC, preload method and dedicated dialog are
retired; cancellation preserves the current choice. The shared dialog uses native
defaults instead of a Storage-specific title or initial path. Target validation,
migration planning, acknowledgement and restart-time cutover remain product-owned.

On macOS and Windows, the native window publishes `dsh-desktop:window-fullscreen`
after each fullscreen transition and page load. The preload mirrors it to
`html[data-fullscreen]`, allowing DSH's layout to own titlebar clearance even
after a reload. Window and renderer teardown release the listeners.

Desktop update presentation uses `dshDesktop.updates.status/open/subscribe` and
the standard `dsh-desktop:updates-*` channels. DSH owns progress and retry UI;
About only opens the same native flow. The private manual-check IPC, result enum
and About status UI are retired. Minke retains its automatic-download preference,
trusted release checks, digest/provenance validation, retry schedule, cached
installers and explicit install confirmation. A verified OS installer is still
`available`: DSH's `ready`/`installing` phases imply an automatic install/restart,
which Minke does not perform. The remaining private update settings IPC stores
only `autoDownload`, a preference absent from the standard bridge.
