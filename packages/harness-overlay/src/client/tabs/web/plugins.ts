import type {
  WebTabsController,
} from "./controller.ts";

export const DSH_PLUGINS_URL =
  "https://github.com/topics/dsh-plugin";

/** Open the curated DSH plugin topic through the existing Web tab adapter. */
export function openDshPlugins(
  controller: Pick<WebTabsController, "open">,
  title: string,
): string | undefined {
  return controller.open(DSH_PLUGINS_URL, title);
}
