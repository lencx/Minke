import type {
  ReactNode,
} from "react";
import {
  ToolbarButton,
} from "@minke/harness-overlay/client/tabs/components/ToolbarButton.tsx";
import type {
  ManagedTab,
  TabRenderer,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  FilesTabsController,
} from "./controller.ts";
import type {
  CodeThemeSettingsRuntime,
} from "./code-theme-runtime.ts";
import {
  BackIcon,
  FilesIcon,
  ForwardIcon,
  ListModeIcon,
  OpenFolderIcon,
  TreeModeIcon,
  UpIcon,
} from "./icons.tsx";
import {
  FileAddressBar,
} from "./FileAddressBar.tsx";
import {
  confirmFilesTabClose,
} from "./close-confirm.ts";
import {
  FileManagerView,
} from "./FileManagerView.tsx";
import type {
  FilesTabsTranslate,
} from "./locales.ts";
import {
  isFilesTab,
} from "./types.ts";

function leadingActions(
  tab: ManagedTab,
  controller: FilesTabsController,
  t: FilesTabsTranslate,
): ReactNode {
  if (!isFilesTab(tab)) return null;
  return (
    <>
      <label
        className="minke-files-mode-select"
        title={t("files.layout.group")}
      >
        <span aria-hidden="true">
          {tab.payload.viewMode === "tree" ? (
            <TreeModeIcon />
          ) : (
            <ListModeIcon />
          )}
        </span>
        <select
          aria-label={t("files.layout.group")}
          value={`${tab.payload.viewMode}-${tab.payload.explorerPosition}`}
          onChange={(event) => {
            const [viewMode, explorerPosition] =
              event.currentTarget.value.split("-");
            if (
              (viewMode === "list" || viewMode === "tree") &&
              (
                explorerPosition === "left" ||
                explorerPosition === "right"
              )
            ) {
              controller.setViewLayout(
                tab.id,
                viewMode,
                explorerPosition,
              );
            }
          }}
        >
          <option value="list-left">
            {t("files.layout.listLeft")}
          </option>
          <option value="list-right">
            {t("files.layout.listRight")}
          </option>
          <option value="tree-left">
            {t("files.layout.treeLeft")}
          </option>
          <option value="tree-right">
            {t("files.layout.treeRight")}
          </option>
        </select>
      </label>
      <ToolbarButton
        label={t("files.nav.back")}
        disabled={!tab.payload.canGoBack}
        onClick={() => controller.back(tab.id)}
      >
        <BackIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("files.nav.forward")}
        disabled={!tab.payload.canGoForward}
        onClick={() => controller.forward(tab.id)}
      >
        <ForwardIcon />
      </ToolbarButton>
      <ToolbarButton
        label={t("files.nav.up")}
        disabled={tab.payload.parent === undefined}
        onClick={() => controller.up(tab.id)}
      >
        <UpIcon />
      </ToolbarButton>
    </>
  );
}

/** Host-backed Files renderer registered beside Web and Terminal. */
export function createFilesTabRenderer(
  controller: FilesTabsController,
  codeThemes: CodeThemeSettingsRuntime,
  t: FilesTabsTranslate,
): TabRenderer {
  return {
    kind: "files",
    createOptions: () => [
      {
        id: "files",
        label: t("files.create.label"),
        order: 0,
        icon: <FilesIcon size={20} />,
        create: (context) => {
          controller.create(
            context.cwd,
            t("files.tab.new"),
          );
        },
      },
    ],
    renderIcon: () => <FilesIcon size={13} />,
    renderLeadingActions: (tab) =>
      leadingActions(tab, controller, t),
    renderTrailingActions: (tab) => (
      <>
        <ToolbarButton
          label={t("files.nav.openSystem")}
          disabled={
            !isFilesTab(tab) || tab.payload.path === undefined
          }
          onClick={() => {
            if (
              isFilesTab(tab) &&
              tab.payload.path !== undefined
            ) {
              controller.open(tab.id, tab.payload.path);
            }
          }}
        >
          <OpenFolderIcon />
        </ToolbarButton>
      </>
    ),
    renderToolbarCenter: (tab) =>
      isFilesTab(tab)
        ? (
          <FileAddressBar
            tab={tab}
            controller={controller}
            t={t}
          />
        )
        : null,
    subtitle: (tab) =>
      isFilesTab(tab) ? tab.payload.path : undefined,
    loading: (tab) =>
      isFilesTab(tab) && tab.payload.loading,
    loadingLabel: (tab) =>
      t("files.state.loading", {
        path: isFilesTab(tab) ? tab.payload.path ?? "" : "",
      }),
    beforeClose: (tab) => confirmFilesTabClose(tab, t),
    renderView: (tab, active) =>
      isFilesTab(tab)
        ? (
          <FileManagerView
            key={tab.id}
            tab={tab}
            active={active}
            controller={controller}
            codeThemes={codeThemes}
            t={t}
          />
        )
        : null,
  };
}
