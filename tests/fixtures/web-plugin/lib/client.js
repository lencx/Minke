window.__ModuleLoader__.load({
  id: "@dsh-desktop/smoke-web-plugin",
  factory: () => ({
    apply() {
      document.documentElement.dataset.dshExternalWebPlugin = "active";
    },
  }),
});
