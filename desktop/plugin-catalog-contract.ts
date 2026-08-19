import {
  parsePluginCatalogGitHubToken,
} from "@lencx/minke-plugin-catalog/contract";

export const PLUGIN_CATALOG_READ_CHANNEL =
  "minke:plugin-catalog:read";
export const PLUGIN_CATALOG_REFRESH_CHANNEL =
  "minke:plugin-catalog:refresh";
export const PLUGIN_CATALOG_CANCEL_CHANNEL =
  "minke:plugin-catalog:cancel";
export const PLUGIN_CATALOG_INSTALL_CHANNEL =
  "minke:plugin-catalog:install";
export const PLUGIN_CATALOG_TOKEN_SET_CHANNEL =
  "minke:plugin-catalog:token-set";
export const PLUGIN_CATALOG_TOKEN_CLEAR_CHANNEL =
  "minke:plugin-catalog:token-clear";

export interface PluginCatalogInstallRequest {
  pluginId: string;
}

export interface PluginCatalogTokenSetRequest {
  token: string;
}

export function parsePluginCatalogInstallRequest(
  value: unknown,
): PluginCatalogInstallRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "plugin catalog install request must be an object",
    );
  }
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).length !== 1 ||
    typeof request.pluginId !== "string" ||
    request.pluginId.length === 0 ||
    request.pluginId.length > 201
  ) {
    throw new TypeError(
      "invalid plugin catalog install request",
    );
  }
  return { pluginId: request.pluginId };
}

export function parsePluginCatalogTokenSetRequest(
  value: unknown,
): PluginCatalogTokenSetRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      "plugin catalog token request must be an object",
    );
  }
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).length !== 1 ||
    typeof request.token !== "string"
  ) {
    throw new TypeError(
      "invalid plugin catalog token request",
    );
  }
  return {
    token: parsePluginCatalogGitHubToken(request.token),
  };
}

export {
  parsePluginCatalogGitHubToken,
  parsePluginCatalogSnapshot,
  type PluginCatalogSnapshot,
} from "@lencx/minke-plugin-catalog/contract";
