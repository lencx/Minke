import {
  isProductShortcutActionId,
  parseShortcutBindings,
} from "@minke/harness-overlay/shortcut-contract.ts";
import type {
  DesktopBridgeWindow,
  DesktopShortcutPort,
} from "./contracts.ts";

/** Adapt the isolated preload API to the shortcut runtime's store port. */
export function desktopShortcutStore(
  source: DesktopBridgeWindow =
    window as unknown as DesktopBridgeWindow,
): DesktopShortcutPort {
  const bridge = source.minkeDesktop?.shortcuts;
  if (bridge === undefined) {
    return {
      available: false,
      async read() {
        return {};
      },
      async write() {
        throw new Error("Minke desktop shortcut bridge is unavailable");
      },
      subscribe() {
        return () => {};
      },
    };
  }
  return {
    available: true,
    async read() {
      return parseShortcutBindings(await bridge.read());
    },
    async write(bindings) {
      await bridge.write(parseShortcutBindings(bindings));
    },
    subscribe(listener) {
      return bridge.subscribe((id) => {
        if (isProductShortcutActionId(id)) listener(id);
      });
    },
  };
}
