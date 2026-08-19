import type {
  CSSProperties,
  ReactNode,
} from "react";
import type {
  FileManagerDiffResult,
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
  FilesTabsLocaleKey,
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
  const comparison = preview.comparison;
  let body: ReactNode;
  if (preview.mode === "source") {
    body = (
      <CodeMirrorEditor
        key={`${result.path}:source`}
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
    );
  } else if (comparison?.loading !== false) {
    body = (
      <div className="minke-files-preview__state" role="status">
        <span>{t("files.preview.diff.loading")}</span>
      </div>
    );
  } else if (comparison.error !== undefined) {
    body = (
      <div className="minke-files-preview__state" role="alert">
        <span>
          {t("files.preview.diff.error", {
            error: comparison.error,
          })}
        </span>
        <button
          type="button"
          onClick={() =>
            controller.setPreviewMode(tabId, "diff")}
        >
          {t("files.preview.diff.retry")}
        </button>
      </div>
    );
  } else if (comparison.result?.kind === "unavailable") {
    body = (
      <div className="minke-files-preview__state">
        <span>
          {t(diffUnavailableKey(comparison.result.reason))}
        </span>
      </div>
    );
  } else if (comparison.result?.kind === "text") {
    body = (
      <CodeMirrorEditor
        key={`${result.path}:diff`}
        path={result.path}
        value={content}
        diffOriginal={comparison.result.original}
        label={t("files.preview.diff.editor", {
          name: result.name,
        })}
        readOnly
        active={active}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
  } else {
    body = (
      <div className="minke-files-preview__state" role="status">
        <span>{t("files.preview.diff.loading")}</span>
      </div>
    );
  }
  return (
    <div className="minke-files-preview__document">
      {preview.diskChanged && (
        <div
          className="minke-files-preview__notice"
          role="alert"
        >
          {t("files.preview.diskChanged")}
        </div>
      )}
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
      {body}
    </div>
  );
}

function diffUnavailableKey(
  reason: Extract<
    FileManagerDiffResult,
    { readonly kind: "unavailable" }
  >["reason"],
): FilesTabsLocaleKey {
  switch (reason) {
    case "binary":
      return "files.preview.diff.binary";
    case "git-unavailable":
      return "files.preview.diff.gitUnavailable";
    case "not-repository":
      return "files.preview.diff.notRepository";
    case "too-large":
      return "files.preview.diff.tooLarge";
  }
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
  const canDiff = editableText;
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
        {preview.result?.kind === "text" && (
          <div
            className="minke-files-preview__mode"
            role="group"
            aria-label={t("files.preview.mode.group")}
          >
            <button
              type="button"
              aria-pressed={preview.mode === "source"}
              onClick={() =>
                controller.setPreviewMode(tabId, "source")}
            >
              {t("files.preview.mode.source")}
            </button>
            <button
              type="button"
              aria-pressed={preview.mode === "diff"}
              disabled={!canDiff}
              onClick={() =>
                controller.setPreviewMode(tabId, "diff")}
            >
              {t("files.preview.mode.diff")}
            </button>
          </div>
        )}
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
        {editableText && preview.mode === "source" && (
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
