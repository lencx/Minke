import assert from "node:assert/strict";
import test from "node:test";
import { en, zh } from "@minke/harness-overlay/client/shortcuts/locales.ts";
import {
  createShortcutSectionSource,
} from "@minke/harness-overlay/client/shortcuts/projection.ts";
import { ShortcutRuntime } from "@minke/harness-overlay/client/shortcuts/runtime.ts";

class TestLocale {
  #active = "zh";
  #listeners = new Set();
  #snapshot = Object.freeze({ revision: 0 });

  bind() {
    return (key, params) => {
      const template = ({ zh, en })[this.#active][key] ?? key;
      return template.replace(/\{(\w+)\}/gu, (match, name) =>
        params !== undefined && name in params
          ? String(params[name])
          : match,
      );
    };
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setActive(active) {
    this.#active = active;
    this.#snapshot = Object.freeze({
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of this.#listeners) listener();
  }
}

test("shortcut dictionaries have the same complete key set", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const dictionary of [zh, en]) {
    for (const value of Object.values(dictionary)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value.trim(), "");
    }
  }
  assert.equal(zh["action.toggleSidebar"], "展开或折叠左侧栏");
  assert.equal(en["action.toggleSidebar"], "Toggle Sidebar");
  assert.equal(zh["action.commandPalette"], "打开命令面板");
  assert.equal(en["action.commandPalette"], "Open Command Palette");
  assert.equal(zh["action.sessionBack"], "返回上一会话");
  assert.equal(en["action.sessionBack"], "Back to Previous Session");
  assert.equal(zh["action.sessionForward"], "前往下一会话");
  assert.equal(en["action.sessionForward"], "Forward to Next Session");
  assert.equal(
    zh["action.toggleRightSidebar"],
    "展开或折叠右侧栏",
  );
  assert.equal(
    en["action.toggleRightSidebar"],
    "Toggle Right Sidebar",
  );
  assert.equal(
    zh["action.toggleBottomPanel"],
    "展开或折叠底部栏",
  );
  assert.equal(
    en["action.toggleBottomPanel"],
    "Toggle Bottom Panel",
  );
});

test("action labels react to Harness locale changes", () => {
  const locale = new TestLocale();
  const t = locale.bind();
  const runtime = new ShortcutRuntime(
    {
      available: false,
      async read() {
        return {};
      },
      async write() {},
    },
    undefined,
    "apple",
  );
  runtime.register({
    id: "settings.open",
    label: () => t("action.settings"),
    defaultBinding: "Mod+Comma",
    run() {},
  });
  const source = createShortcutSectionSource(runtime, locale);
  let notifications = 0;
  const unsubscribe = source.subscribe(() => {
    notifications += 1;
  });

  const initial = source.getSnapshot();
  assert.equal(initial.actions[0]?.label, "打开设置");
  locale.setActive("en");
  const translated = source.getSnapshot();
  assert.notEqual(translated, initial);
  assert.equal(translated.actions[0]?.label, "Open Settings");
  assert.equal(notifications, 1);

  unsubscribe();
  runtime.dispose();
});
