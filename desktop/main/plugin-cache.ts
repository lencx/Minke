import { rm } from "node:fs/promises";
import { join } from "node:path";

export function legacyPluginCatalogCacheFilePath(
  userDataPath: string,
): string {
  return join(userDataPath, "plugins", "catalog-v1.json");
}

/** Remove the retired catalog cache without touching plugin credentials. */
export async function clearLegacyPluginCatalogCache(
  userDataPath: string,
): Promise<void> {
  await rm(legacyPluginCatalogCacheFilePath(userDataPath), {
    force: true,
  });
}
