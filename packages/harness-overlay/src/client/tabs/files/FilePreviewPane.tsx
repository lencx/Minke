import type {
  CSSProperties,
  ReactNode,
} from "react";
import type {
  FileManagerTextPreview,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  CodeMirrorEditor,
} from "./CodeMirrorEditor.tsx";
import type {
  FilesTabsController,
} from "./controller.ts";
import {
  ClosePreviewIcon,
  FileIcon,
  OpenSystemIcon,
  SavedPreviewIcon,
  SavePreviewIcon,
  SavingPreviewIcon,
  UnsupportedPreviewIcon,
} from "./icons.tsx";
import type {
  FilesTabsTranslate,
} from "./locales.ts";
import type {
  FilesPreviewState,
} from "./types.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unit = units[0] ?? "KB";
  for (
    let index = 1;
    value >= 1_024 && index < units.length;
    index += 1
  ) {
    value /= 1_024;
    unit = units[index] ?? unit;
  }
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)} ${unit}`;
}

function TextPreview(props: {
  readonly tabId: string;
  readonly preview: FilesPreviewState;
  readonly result: FileManagerTextPreview;
  readonly controller: FilesTabsController;
  readonly t: FilesTabsTranslate;
  readonly active: boolean;
}): ReactNode {
  const {
    tabId,
    preview,
    result,
    controller,
    t,
    active,
  } = props;
  const content = preview.draft ?? result.content;
  return (
    <div className="minke-files-preview__document">
      {preview.saveError !== undefined && (
        <div
          className="minke-files-preview__save-error"
          role="alert"
        >
          {t("files.preview.saveError", {
            error: preview.saveError,
          })}
        </div>
      )}
      {result.truncated && (
        <div
          className="minke-files-preview__notice"
          role="status"
        >
          {t("files.preview.truncated")}
        </div>
      )}
      <CodeMirrorEditor
        key={result.path}
        path={result.path}
        value={content}
        label={t("files.preview.editor", {
          name: result.name,
        })}
        readOnly={result.truncated}
        active={active}
        onChange={(next) =>
          controller.updatePreviewDraft(
            tabId,
            result.path,
            next,
          )}
        onSave={() => controller.savePreview(tabId)}
      />
    </div>
  );
}

function previewBody(
  tabId: string,
  preview: FilesPreviewState,
  controller: FilesTabsController,
  t: FilesTabsTranslate,
  active: boolean,
): ReactNode {
  if (preview.loading) {
    return (
      <div className="minke-files-preview__state" role="status">
        <span className="minke-files-state__pulse" aria-hidden="true">
          <FileIcon name={preview.entry.name} size={22} />
        </span>
        <span>{t("files.preview.loading")}</span>
      </div>
    );
  }
  if (preview.error !== undefined) return null;
  const result = preview.result;
  if (result === undefined) return null;
  if (result.kind === "text") {
    return (
      <TextPreview
        tabId={tabId}
        preview={preview}
        result={result}
        controller={controller}
        t={t}
        active={active}
      />
    );
  }
  if (result.kind === "image") {
    return (
      <figure className="minke-files-preview__image">
        <div>
          <img src={result.dataUrl} alt={result.name} />
        </div>
      </figure>
    );
  }
  return (
    <div className="minke-files-preview__state">
      <span
        className="minke-files-preview__unsupported"
        aria-hidden="true"
      >
        <UnsupportedPreviewIcon size={24} />
      </span>
      <strong>{preview.entry.name}</strong>
      <span>
        {t(
          result.reason === "too-large"
            ? "files.preview.tooLarge"
            : "files.preview.binary",
        )}
      </span>
    </div>
  );
}

export function FilePreviewPane(props: {
  readonly tabId: string;
  readonly preview: FilesPreviewState;
  readonly controller: FilesTabsController;
  readonly t: FilesTabsTranslate;
  readonly active: boolean;
  readonly id?: string;
  readonly style?: CSSProperties;
}): ReactNode {
  const {
    tabId,
    preview,
    controller,
    t,
    active,
  } = props;
  const editableText =
    preview.result?.kind === "text" &&
    !preview.result.truncated;
  return (
    <aside
      id={props.id}
      className="minke-files-preview"
      aria-label={t("files.preview.label")}
      style={props.style}
    >
      <header className="minke-files-preview__header">
        <span aria-hidden="true">
          <FileIcon name={preview.entry.name} size={15} />
        </span>
        <strong title={preview.entry.path}>
          <span>{preview.entry.name}</span>
          {preview.result !== undefined && (
            <span className="minke-files-preview__size">
              {" · "}
              {formatBytes(preview.result.size)}
            </span>
          )}
        </strong>
        {preview.dirty && (
          <span
            className="minke-files-preview__dirty"
            aria-label={t("files.preview.dirty")}
            title={t("files.preview.dirty")}
          />
        )}
        {(preview.saving ||
          preview.saveStatus === "saved") && (
          <span
            className="minke-files-preview__save-status"
            data-state={
              preview.saving ? "saving" : "saved"
            }
            role="status"
            aria-live="polite"
          >
            {preview.saving ? (
              <SavingPreviewIcon size={12} />
            ) : (
              <SavedPreviewIcon size={12} />
            )}
            <span>
              {t(
                preview.saving
                  ? "files.preview.saving"
                  : "files.preview.saved",
              )}
            </span>
          </span>
        )}
        {editableText && (
          <button
            type="button"
            aria-label={t(
              preview.saving
                ? "files.preview.saving"
                : "files.preview.save",
            )}
            title={t(
              preview.saving
                ? "files.preview.saving"
                : "files.preview.save",
            )}
            disabled={!preview.dirty || preview.saving}
            data-saving={preview.saving || undefined}
            onClick={() => controller.savePreview(tabId)}
          >
            {preview.saving ? (
              <SavingPreviewIcon size={14} />
            ) : (
              <SavePreviewIcon size={14} />
            )}
          </button>
        )}
        <button
          type="button"
          aria-label={t("files.preview.openSystem")}
          title={t("files.preview.openSystem")}
          onClick={() => controller.open(tabId, preview.entry.path)}
        >
          <OpenSystemIcon size={14} />
        </button>
        <button
          type="button"
          aria-label={t("files.preview.close")}
          title={t("files.preview.close")}
          disabled={preview.saving}
          onClick={(event) => {
            if (preview.dirty) {
              const view =
                event.currentTarget.ownerDocument.defaultView;
              if (
                view !== null &&
                !view.confirm(
                  t("files.preview.discardConfirm", {
                    name: preview.entry.name,
                  }),
                )
              ) {
                return;
              }
            }
            controller.closePreview(tabId);
          }}
        >
          <ClosePreviewIcon size={14} />
        </button>
      </header>
      {preview.error !== undefined ? (
        <div className="minke-files-preview__state" role="alert">
          <strong>{preview.entry.name}</strong>
          <span>{preview.error}</span>
          <button
            type="button"
            onClick={() =>
              controller.preview(tabId, preview.entry)}
          >
            {t("files.preview.retry")}
          </button>
        </div>
      ) : (
        previewBody(
          tabId,
          preview,
          controller,
          t,
          active,
        )
      )}
    </aside>
  );
}
