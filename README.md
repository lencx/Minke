# Minke

Minke is a desktop AI agent powered by
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It runs
Harness locally and provides a native desktop experience through Electron.

## Harness boundary

`vendor/deepseek-harness` is a pinned, read-only upstream dependency. Minke
does not carry or apply source patches to it. Product features live in
`@lencx/minke-harness-overlay` and compose through Harness's public `--patch`
bundle seam; native-only behavior lives in the Electron preload, main process,
or a minimal document-start desktop bootstrap.

The browser overlay owns all post-boot Minke UI adaptation, including the
macOS Harness surface projection. The bootstrap extension is deliberately
CSS-only: it supplies first-paint transparency and native drag regions before
Harness loads, but contains no Harness DOM traversal or product behavior.

`pnpm harness:verify` rejects tracked or untracked changes anywhere in the
Harness checkout. Run `pnpm harness:stage` after changing the pinned Harness
commit or rebuilding its runtime closure. During normal Minke development,
`pnpm harness:stage:fast` validates the existing closure and refreshes only the
external overlay without touching the Harness workspace.

## Desktop additions

- Settings → Keyboard shortcuts configures Minke actions. Defaults are
  `Cmd/Ctrl+,` for Settings and `Cmd/Ctrl+N` for New Session. Overrides are
  validated and stored in Minke's Electron user-data directory.
- Shortcut labels and settings copy register with Harness's own locale service,
  so its persisted Chinese/English preference, fallback, and live language
  switching remain the single source of truth.
- Desktop-owned bootstrap and native-dialog copy uses a typed TypeScript
  dictionary. It starts from Electron's `app.getLocale()` (falling back to
  English), then follows Harness's active locale through an isolated preload
  channel; Electron never parses Harness's `settings.yaml`.
- Development bootstrap and Harness origins remain inside Electron. Only
  explicit navigation to an external HTTP(S) or mail link is handed to the
  system browser.
- Native window appearance subscribes to Harness's theme service. Explicit
  light or dark themes update Electron chrome; the `system` preference leaves
  Electron connected to operating-system theme changes.
- On macOS, `@lencx/minke-harness-overlay` applies and releases the sidebar,
  titlebar, and translucent-surface projection through Harness's plugin
  lifecycle. The preload exposes only a small immutable surface capability so
  the same overlay bundle remains inert in a normal browser.
