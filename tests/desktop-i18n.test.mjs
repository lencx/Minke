import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  desktopDictionaries,
  DesktopLocaleRuntime,
  translateDesktop,
} from "@minke/desktop/i18n.ts";
import {
  isDesktopLocale,
  resolveDesktopLocale,
  WINDOW_LOCALE_CHANNEL,
} from "@minke/desktop/locale-contract.ts";
import {
  bindWindowLocale,
} from "@minke/desktop/main/window-locale.ts";
import {
  installDesktopClient,
} from "@minke/harness-overlay/client/desktop/install.ts";
import {
  isHarnessLocale,
} from "@minke/harness-overlay/client/core/context.ts";

test("desktop locale follows app.getLocale semantics and falls back to en", () => {
  assert.equal(resolveDesktopLocale("zh-CN"), "zh");
  assert.equal(resolveDesktopLocale("zh-Hant-TW"), "zh");
  assert.equal(resolveDesktopLocale("ZH_hant"), "zh");
  assert.equal(resolveDesktopLocale("en-US"), "en");
  assert.equal(resolveDesktopLocale("fr-FR"), "en");
  assert.equal(resolveDesktopLocale(""), "en");
  assert.equal(resolveDesktopLocale(undefined), "en");
});

test("desktop locale boundaries accept BCP 47-style language-pack ids", () => {
  for (const locale of [
    "fr",
    "fr-FR",
    "zh-Hant-TW",
    "de-DE-u-co-phonebk",
  ]) {
    assert.equal(isHarnessLocale(locale), true, locale);
    assert.equal(isDesktopLocale(locale), true, locale);
  }
  for (const locale of [
    "",
    "ZH_hant",
    "en-abcdefghi",
    "9n",
    null,
    {},
  ]) {
    assert.equal(isHarnessLocale(locale), false, String(locale));
    assert.equal(isDesktopLocale(locale), false, String(locale));
  }
});

test("desktop dictionaries are complete and interpolate native details", () => {
  assert.deepEqual(
    Object.keys(desktopDictionaries.en).sort(),
    Object.keys(desktopDictionaries.zh).sort(),
  );
  for (const dictionary of Object.values(desktopDictionaries)) {
    for (const value of Object.values(dictionary)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value.trim(), "");
    }
  }

  assert.equal(
    translateDesktop("zh", "runtime.exitCode", { value: 17 }),
    "退出码：17",
  );
  assert.equal(
    translateDesktop("en", "runtime.exitCode", { value: 17 }),
    "Exit code: 17",
  );
  assert.equal(
    translateDesktop("zh", "sessionExport.saveDialogTitle"),
    "导出 Session 日志",
  );
  assert.equal(
    translateDesktop("en", "sessionExport.failedTitle"),
    "Unable to export Session log",
  );
  assert.equal(
    translateDesktop("zh-Hant-TW", "bootstrap.loading"),
    "正在启动 Minke",
  );
  assert.equal(
    translateDesktop("fr-FR", "bootstrap.loading"),
    "Starting Minke",
  );
});

test("desktop locale runtime preserves language-pack ids and projects native copy", () => {
  const runtime = new DesktopLocaleRuntime("fr-FR");
  assert.deepEqual(runtime.getSnapshot(), {
    active: "fr-FR",
    revision: 0,
  });
  assert.equal(runtime.t("bootstrap.loading"), "Starting Minke");

  runtime.setLocale("zh-Hant");
  assert.deepEqual(runtime.getSnapshot(), {
    active: "zh-Hant",
    revision: 1,
  });
  assert.equal(runtime.t("bootstrap.loading"), "正在启动 Minke");

  runtime.setLocale("not_a_tag");
  assert.equal(runtime.getSnapshot().active, "zh-Hant");
  assert.equal(runtime.getSnapshot().revision, 1);
});

test("only authorized, valid Harness locale messages update desktop state", () => {
  const ipc = new EventEmitter();
  const runtime = new DesktopLocaleRuntime("en");
  const binding = bindWindowLocale(
    { webContents: { ipc } },
    runtime,
    (event) => event === "allowed",
  );
  let notifications = 0;
  const unsubscribe = runtime.subscribe(() => {
    notifications += 1;
  });

  ipc.emit(WINDOW_LOCALE_CHANNEL, "denied", "zh");
  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "fr_FR");
  assert.equal(runtime.getSnapshot().active, "en");
  assert.equal(notifications, 0);

  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "fr-FR");
  assert.deepEqual(runtime.getSnapshot(), {
    active: "fr-FR",
    revision: 1,
  });
  assert.equal(runtime.t("bootstrap.loading"), "Starting Minke");
  assert.equal(notifications, 1);

  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "zh-Hant");
  assert.deepEqual(runtime.getSnapshot(), {
    active: "zh-Hant",
    revision: 2,
  });
  assert.equal(
    runtime.t("bootstrap.loading"),
    "正在启动 Minke",
  );
  assert.equal(notifications, 2);

  binding.dispose();
  binding.dispose();
  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "en");
  assert.equal(runtime.getSnapshot().active, "zh-Hant");
  assert.equal(ipc.listenerCount(WINDOW_LOCALE_CHANNEL), 0);
  unsubscribe();
});

test("desktop client locale sync cannot be interrupted by language-pack ids", () => {
  const previousWindow = globalThis.window;
  const published = [];
  const listeners = new Map();
  globalThis.window = {
    minkeDesktop: {
      locale: {
        publish(locale) {
          published.push(locale);
        },
      },
    },
  };
  try {
    installDesktopClient({
      effect() {},
      locale: {
        getSnapshot() {
          return { active: "fr-FR", revision: 0 };
        },
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      theme: {
        getTheme() {
          return {
            preference: "system",
            active: { colorScheme: "dark" },
          };
        },
      },
    });

    assert.deepEqual(published, ["fr-FR"]);
    assert.doesNotThrow(() => {
      listeners.get("locale/change")?.({
        active: "zh-Hant-TW",
        revision: 1,
      });
    });
    assert.deepEqual(published, ["fr-FR", "zh-Hant-TW"]);

    listeners.get("locale/change")?.({
      active: "fr_FR",
      revision: 2,
    });
    assert.deepEqual(
      published,
      ["fr-FR", "zh-Hant-TW"],
      "malformed locale ids must not cross into preload",
    );
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("locale binding can dispose after its BrowserWindow is destroyed", () => {
  const ipc = new EventEmitter();
  let destroyed = false;
  const window = {
    get webContents() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return { ipc };
    },
  };
  const runtime = new DesktopLocaleRuntime("en");
  const binding = bindWindowLocale(window, runtime, () => true);

  destroyed = true;
  assert.doesNotThrow(() => binding.dispose());
  assert.equal(ipc.listenerCount(WINDOW_LOCALE_CHANNEL), 0);
});
