# Minke Harness overlay

This package is Minke's product-owned extension layer for DeepSeek Harness.
It is installed into the generated desktop runtime and composed through the
public `--patch` bundle seam. Nothing in this package is copied into or
applied over `vendor/deepseek-harness`.

The browser half owns Minke's product policy, configurable keyboard shortcuts,
and post-boot desktop surface adaptation. It uses:

- `settings.onboarding` slot shadowing to bypass Harness's developer-only
  internal-testing notice without changing the upstream plugin;
- `settings.section` to render its settings page;
- `ctx.workspaces.startSession()` for the New Session action;
- the Settings trigger's accessible DOM contract for the Settings action;
- Harness's `ctx.locale` registry and revision source for synchronized zh/en
  copy;
- Harness's locale snapshot and `locale/change` event for native desktop copy;
- Harness's `ctx.theme` snapshot and `theme/change` event for native window
  synchronization;
- a lifecycle-managed DOM adapter for the macOS sidebar, titlebar, and
  translucent surfaces; the adapter is capability-gated by the isolated
  preload and removes its observer, markers, and stylesheet on disposal;
- the isolated Minke preload bridge for durable desktop-owned preferences.

The separate document-start extension remains CSS-only. It exists solely
because first-paint transparency and Electron drag regions must be present
before Harness initializes; it does not traverse or modify the Harness DOM.
