import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  desktopDictionaries,
  DesktopLocaleRuntime,
  translateDesktop,
} from "@minke/desktop/i18n.ts";
import {
  resolveDesktopLocale,
  WINDOW_LOCALE_CHANNEL,
} from "@minke/desktop/locale-contract.ts";
import {
  bindWindowLocale,
} from "@minke/desktop/main/window-locale.ts";

test("desktop locale follows app.getLocale semantics and falls back to en", () => {
  assert.equal(resolveDesktopLocale("zh-CN"), "zh");
  assert.equal(resolveDesktopLocale("ZH_hant"), "zh");
  assert.equal(resolveDesktopLocale("en-US"), "en");
  assert.equal(resolveDesktopLocale("fr-FR"), "en");
  assert.equal(resolveDesktopLocale(""), "en");
  assert.equal(resolveDesktopLocale(undefined), "en");
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
});

test("only authorized Harness locale messages update desktop state", () => {
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
  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "fr");
  assert.equal(runtime.getSnapshot().active, "en");
  assert.equal(notifications, 0);

  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "zh");
  assert.deepEqual(runtime.getSnapshot(), {
    active: "zh",
    revision: 1,
  });
  assert.equal(
    runtime.t("bootstrap.loading"),
    "正在启动 Minke",
  );
  assert.equal(notifications, 1);

  binding.dispose();
  binding.dispose();
  ipc.emit(WINDOW_LOCALE_CHANNEL, "allowed", "en");
  assert.equal(runtime.getSnapshot().active, "zh");
  assert.equal(ipc.listenerCount(WINDOW_LOCALE_CHANNEL), 0);
  unsubscribe();
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
