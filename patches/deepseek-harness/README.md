# DeepSeek Harness runtime patches

Minke keeps `vendor/deepseek-harness` pinned and pristine. Local fixes that cannot be accepted upstream are declared in `config/harness-runtime.json` and applied only to the disposable staged runtime after workspace deployment.

The applicator accepts git unified diffs that modify existing text files below `node_modules/@deepseek-ai/`. It rejects path escapes, file creation/deletion, renames, binary patches, stale hunks, and skipped patches. Patch contents are part of the runtime fingerprint and metadata; validation also reverse-checks that every declared patch is present before publishing or fast refresh.

`win32-directory-picker.patch` is pinned to Harness `dsh-v0.1.2-alpha.5` (`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`). It:

- routes the directory dialog worker and Windows ACL sandbox runner through `MINKE_NODE_EXECUTABLE`, with Electron Node mode explicitly restored for the dialog worker;
- keeps the dialog worker's IPC channel open through non-terminal `showing` progress and disconnects only after a terminal result;
- leaves the upstream bounded `koffi.view` UTF-16LE decoder intact, including its two-byte terminator scan for paths containing code points such as `U+5F00`.

`windows-background-processes.patch` is pinned to the same Harness commit. It:

- makes every first-party non-terminal child process explicitly suppress native Windows console windows, including the unified subprocess runtime, its teardown helpers, sandbox probes, browser handoff, plugin management, and the experimental Python runtime;
- leaves PTY/ConPTY terminal sessions on their dedicated `spawnTerminal` lifecycle path.

After applying that static source patch, staging enumerates every JavaScript
artifact actually deployed by `dsh-sandbox-windows-acl` and hides each
restricted-token child with
`STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES` and `SW_HIDE`. This transform is
deliberately independent of generated `types-<hash>.js` names, which differ
between platform-specific dependency closures. The staged-artifact AST audit
then rejects any direct or restricted launch site that remains visible.

`optional-plugin-isolation.patch` is pinned to the same Harness commit. It:

- marks entries inserted by profile bundles listed in the profile's `dependencies` as isolated, while installation-owned bundles and launcher overlays remain fail-fast;
- skips external profile bundles selected by Minke's disabled-plugin policy or safe mode without changing the profile manifest;
- retains a failed external entry as Loader health state, logs its original activation error, and lets unrelated entries finish booting;
- exposes isolated activation failures as `failed` through the existing plugin inventory so Settings can report the degraded plugin.

`dynamic-trusted-hosts.patch` is pinned to the same Harness commit. It:

- keeps one mutable trusted-host policy behind the existing Connection service so registered HTTP, WebSocket, and RPC routes observe an atomic replacement;
- validates every replacement before changing the live policy and retains the loopback-only fence for privileged methods;
- lets Minke apply an exact authority through its private parent-child process channel without restarting Harness.

`process-environment-boundaries.patch` is pinned to the same Harness commit. It:

- strips Electron/Node bootstrap controls from ordinary subprocesses, native integrations, and browser handoff children so ambient desktop runtime state cannot leak across execution boundaries;
- restores Minke's managed Node executable and bootstrap only for an explicitly recognized embedded-Node launch, including terminal and Windows ACL paths.

The former Details layout/presentation patches remain removed at this pin.
Harness owns adaptive conversation width, the native top-level `details` slot,
and Harness's whole-session turn rail with deep-history load-and-jump; Minke
Tabs uses only `ILayout.openDetails/closeDetails`. The former subagent route
patch also stays removed because Harness natively resolves the effective parent
provider, model, and reasoning effort.

Alpha.3 removes only Harness's optional SQLite Session persistence backend.
Minke's IM Gateway SQLite mailbox is a separate desktop transport store and is
not part of that Session persistence contract.

After changing the upstream pin or a patch, run:

```sh
pnpm harness:verify
pnpm harness:stage
pnpm test:desktop
```
