# DeepSeek Harness runtime patches

Minke keeps `vendor/deepseek-harness` pinned and pristine. Local fixes that cannot be accepted upstream are declared in `config/harness-runtime.json` and applied only to the disposable staged runtime after workspace deployment.

The applicator accepts git unified diffs that modify existing text files below `node_modules/@deepseek-ai/`. It rejects path escapes, file creation/deletion, renames, binary patches, stale hunks, and skipped patches. Patch contents are part of the runtime fingerprint and metadata; validation also reverse-checks that every declared patch is present before publishing or fast refresh.

`win32-directory-picker.patch` is pinned to Harness `dsh-v0.1.1-rc.2` (`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`). It:

- routes the directory dialog worker and Windows ACL sandbox runner through `MINKE_NODE_EXECUTABLE`, with Electron Node mode explicitly restored for the dialog worker;
- copies the COM-owned UTF-16 folder path with Koffi's dedicated `decode.string16` API instead of creating an external `ArrayBuffer` with `koffi.view`.

`windows-background-processes.patch` is pinned to the same Harness commit. It:

- makes every first-party non-terminal child process explicitly suppress native Windows console windows, including the unified subprocess runtime, its teardown helpers, sandbox probes, browser handoff, and plugin management;
- hides restricted-token children with `STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES` and `SW_HIDE`, preserving the creation mode required by the Windows ACL sandbox;
- leaves PTY/ConPTY terminal sessions on their dedicated `spawnTerminal` lifecycle path.

`tabs-details-layout.patch` is pinned to the same Harness commit. It:

- lets the details grid track reflow up to two thirds of the area remaining after the sidebar, so a wider Files reader compresses the conversation;
- exposes the existing `setDetails` store action through `ctx.layout`, allowing Minke to restore a persisted width without simulating pointer input;
- raises the stored-width guard for Minke's wider overlay continuation. Minke still owns the final viewport clamp and leaves a 20px conversation remainder.
- exposes semantic Details open state through `ctx.layout.details`, with subscription and presentation-host registration while retaining the native layout as fallback.

`details-presentation-slot.patch` is pinned to the same Harness commit. It:

- publishes selected Details state and the native panel tree through the declared `conversation.details.presentation` slot;
- keeps the upstream in-place panel as the slot fallback when no external presentation host is registered;
- adds stable details-panel anchors used by Minke's structural adapter.

`optional-plugin-isolation.patch` is pinned to the same Harness commit. It:

- marks entries inserted by profile bundles listed in the profile's `dependencies` as isolated, while installation-owned bundles and launcher overlays remain fail-fast;
- skips external profile bundles selected by Minke's disabled-plugin policy or safe mode without changing the profile manifest;
- retains a failed external entry as Loader health state, logs its original activation error, and lets unrelated entries finish booting;
- exposes isolated activation failures as `failed` through the existing plugin inventory so Settings can report the degraded plugin.

After changing the upstream pin or a patch, run:

```sh
pnpm harness:verify
pnpm harness:stage
pnpm test:desktop
```
