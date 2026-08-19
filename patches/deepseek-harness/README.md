# DeepSeek Harness runtime patches

Minke keeps `vendor/deepseek-harness` pinned and pristine. Local fixes that
cannot be accepted upstream are declared in `config/harness-runtime.json` and
applied only to the disposable staged runtime after workspace deployment.

The applicator accepts git unified diffs that modify existing text files below
`node_modules/@deepseek-ai/`. It rejects path escapes, file creation/deletion,
renames, binary patches, stale hunks, and skipped patches. Patch contents are
part of the runtime fingerprint and metadata; validation also reverse-checks
that every declared patch is present before publishing or fast refresh.

`win32-directory-picker.patch` is pinned to Harness
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`. It:

- routes the directory dialog worker and Windows ACL sandbox runner through
  `MINKE_NODE_EXECUTABLE`, with Electron Node mode explicitly restored for the
  dialog worker;
- copies the COM-owned UTF-16 folder path with Koffi's dedicated
  `decode.string16` API instead of creating an external `ArrayBuffer` with
  `koffi.view`.

After changing the upstream pin or a patch, run:

```sh
pnpm harness:verify
pnpm harness:stage
pnpm test:desktop
```
