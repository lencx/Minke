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

The cache is stored at `plugins/catalog-v1.json` below the supplied user-data
root. Writes use a private temporary file followed by an atomic rename.

Discovery and validation are read-only. The scanner does not clone
repositories, install dependencies, run lifecycle scripts, build packages, or
execute plugin code.
