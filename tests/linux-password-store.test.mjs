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
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "linux",
      desktopEnvironment: "KDE",
    }),
    { store: undefined, reason: "kde-default" },
  );
});

test("non-Linux platforms never request a Linux backend", () => {
  assert.deepEqual(
    resolveLinuxPasswordStore({
      platform: "darwin",
      desktopEnvironment: "Hyprland",
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
      commandLine: ["Minke", "--password-store=kwallet5"],
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

test("the override environment variable is named for the override", () => {
  assert.equal(MINKE_PASSWORD_STORE_ENV, "MINKE_PASSWORD_STORE");
});
