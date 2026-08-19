# Minke Plugin Catalog

Local plugin discovery, static validation, and durable catalog snapshots for
Minke.

The package is independent of Electron. A host supplies its user-data root and
may expose the returned snapshots through its own transport:

```ts
import { PluginCatalogService } from "@lencx/minke-plugin-catalog";

const catalog = new PluginCatalogService({
  userDataPath,
});

await catalog.start();
const snapshot = await catalog.read();
```

`start()` loads the last usable snapshot and schedules background refreshes.
`read()` is cache-only. `refresh()` coalesces concurrent requests and returns
the latest usable snapshot even when a refresh fails. `cancelRefresh()` stops
only the active refresh and leaves the service and its last usable cache
available. `dispose()` stops scheduled work and aborts active network
requests. Individual network requests have a bounded timeout, configurable
with `requestTimeoutMs`.

Snapshots contain validated plugin entries, a bounded and ranked set of
repositories awaiting validation, installed-package markers, and value-free
GitHub credential metadata. A host can supply a
`PluginCatalogCredentialProvider` to resolve and update a token without
placing the secret in snapshots, or a `PluginCatalogInstallationAdapter` to
enable installation. `install()` accepts only an ID already present in the
validated catalog and permits one-click installation only for prebuilt
entries that do not require lifecycle-script allowance.

The cache is stored at `plugins/catalog-v1.json` below the supplied user-data
root. Writes use a private temporary file followed by an atomic rename.

Discovery and validation are read-only. The scanner does not clone
repositories, install dependencies, run lifecycle scripts, build packages, or
execute plugin code. Credential encryption and installation process isolation
remain explicit host responsibilities.
