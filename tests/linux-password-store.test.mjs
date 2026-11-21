import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLinuxPasswordStore,
  desktopEnvironmentTokens,
  MINKE_PASSWORD_STORE_ENV,
  resolveLinuxPasswordStore,
} from "@minke/desktop/main/linux-password-store.ts";

test("unknown desktops request the Secret Service backend", () => {
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
      desktopEnvironment: "Hyprland",
    }),
    { store: "gnome-libsecret", reason: "secret-service-fallback" },
  );
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
    }),
    { store: "gnome-libsecret", reason: "secret-service-fallback" },
  );
});

test("KDE sessions keep the Chromium KWallet default", () => {
  for (const desktop of [
    { desktopEnvironment: "KDE" },
    { desktopSession: "kde-plasma" },
    { desktopSession: "kde", kdeSessionVersion: "6" },
    { kdeFullSession: "true", kdeSessionVersion: "5" },
  ]) {
    assert.deepEqual(
      resolveLinuxPasswordStore({ platform: "linux", ...desktop }),
      { store: undefined, reason: "kde-default" },
    );
  }
});

test("non-Linux platforms never request a Linux backend", () => {
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "darwin",
      desktopEnvironment: "Hyprland",
      explicitStore: "gnome-libsecret",
    }),
    { store: undefined, reason: "not-linux" },
  );
});

test("an explicit override wins over the detected desktop", () => {
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
      desktopEnvironment: "KDE",
      explicitStore: "gnome-libsecret",
    }),
    { store: "gnome-libsecret", reason: "explicit-override" },
  );
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
      explicitStore: "kwallet",
    }),
    { store: "kwallet", reason: "explicit-override" },
  );
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
      explicitStore: "not-a-store",
    }),
    { store: undefined, reason: "invalid-override" },
  );
});

test("a backend already passed on the command line is preserved", () => {
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
      desktopEnvironment: "Hyprland",
      explicitStore: "gnome-libsecret",
      hasPasswordStoreSwitch: true,
    }),
    { store: undefined, reason: "command-line-override" },
  );
});

test("desktop tokens are split on the colon separator", () => {
  assert.deepEqual(
    desktopEnvironmentTokens("ubuntu:GNOME"),
    ["ubuntu", "GNOME"],
  );
  assert.deepEqual(desktopEnvironmentTokens(undefined), []);
});

test("the resolved backend is applied as a Chromium command line switch", () => {
  const switches = [];
  const decision = applyLinuxPasswordStore(
    {
      commandLine: {
        hasSwitch() {
          return false;
        },
        appendSwitch(name, value) {
          switches.push([name, value]);
        },
      },
    },
    {
      platform: "linux",
      desktopEnvironment: "Hyprland",
    },
  );
  assert.deepEqual(switches, [["password-store", "gnome-libsecret"]]);
  assert.equal(decision.store, "gnome-libsecret");
});

test("no switch is applied when Chromium already picks a backend", () => {
  const switches = [];
  applyLinuxPasswordStore(
    {
      commandLine: {
        hasSwitch() {
          return false;
        },
        appendSwitch(name, value) {
          switches.push([name, value]);
        },
      },
    },
    {
      platform: "linux",
      desktopEnvironment: "KDE",
    },
  );
  assert.deepEqual(switches, []);
});

test("the application honors Electron's existing password-store switch", () => {
  const decision = applyLinuxPasswordStore(
    {
      commandLine: {
        hasSwitch(name) {
          return name === "password-store";
        },
        appendSwitch() {
          assert.fail("the existing switch must be preserved");
        },
      },
    },
    { platform: "linux", explicitStore: "gnome-libsecret" },
  );
  assert.equal(decision.reason, "command-line-override");
});

test("the override environment variable is named for the override", () => {
  assert.equal(MINKE_PASSWORD_STORE_ENV, "MINKE_PASSWORD_STORE");
});
