import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  bindWindowTheme,
} from "@minke/desktop/main/window-theme.ts";
import { WINDOW_THEME_CHANNEL } from "@minke/desktop/window-theme-contract.ts";

function fixture() {
  const ipc = new EventEmitter();
  const nativeTheme = { themeSource: "system" };
  const binding = bindWindowTheme({ webContents: { ipc } }, nativeTheme);
  return { binding, ipc, nativeTheme };
}

test("explicit renderer themes update the native window appearance", () => {
  const { binding, ipc, nativeTheme } = fixture();

  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "dark",
    colorScheme: "dark",
  });
  assert.equal(nativeTheme.themeSource, "dark");

  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "light",
    colorScheme: "light",
  });
  assert.equal(nativeTheme.themeSource, "light");
  binding.dispose();
});

test("system preference leaves native chrome connected to the OS", () => {
  const { binding, ipc, nativeTheme } = fixture();

  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "system",
    colorScheme: "dark",
  });
  assert.equal(nativeTheme.themeSource, "system");
  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "system",
    colorScheme: "light",
  });

  assert.equal(nativeTheme.themeSource, "system");
  binding.dispose();
});

test("early resolved schemes cover pre-plugin theme bootstrap", () => {
  const { binding, ipc, nativeTheme } = fixture();

  ipc.emit(WINDOW_THEME_CHANNEL, {}, { colorScheme: "dark" });
  assert.equal(nativeTheme.themeSource, "dark");
  ipc.emit(WINDOW_THEME_CHANNEL, {}, { colorScheme: "light" });
  assert.equal(nativeTheme.themeSource, "light");
  binding.dispose();
});

test("invalid renderer messages cannot change the native appearance", () => {
  const { binding, ipc, nativeTheme } = fixture();

  for (const message of [
    null,
    { colorScheme: "sepia" },
    {},
    { colorScheme: "dark", extra: true },
    { preference: "system", colorScheme: "dark", extra: true },
    { preference: "light", colorScheme: "dark" },
    { preference: "sepia", colorScheme: "dark" },
  ]) {
    ipc.emit(WINDOW_THEME_CHANNEL, {}, message);
  }

  assert.equal(nativeTheme.themeSource, "system");
  binding.dispose();
});

test("disposing the binding stops later renderer updates", () => {
  const { binding, ipc, nativeTheme } = fixture();

  binding.dispose();
  binding.dispose();
  ipc.emit(WINDOW_THEME_CHANNEL, {}, {
    preference: "dark",
    colorScheme: "dark",
  });

  assert.equal(nativeTheme.themeSource, "system");
  assert.equal(ipc.listenerCount(WINDOW_THEME_CHANNEL), 0);
});

test("theme binding can dispose after its BrowserWindow is destroyed", () => {
  const ipc = new EventEmitter();
  let destroyed = false;
  const window = {
    get webContents() {
      if (destroyed) throw new TypeError("Object has been destroyed");
      return { ipc };
    },
  };
  const binding = bindWindowTheme(
    window,
    { themeSource: "system" },
  );

  destroyed = true;
  assert.doesNotThrow(() => binding.dispose());
  assert.equal(ipc.listenerCount(WINDOW_THEME_CHANNEL), 0);
});
