import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { TabsCreateMenu, type TabsCreateMenuOption } from "../TabsCreateMenu.tsx";
import type { FilesTabsController } from "./controller.ts";
import { filesDocumentKind } from "./document-kind.ts";
import { ClosePreviewIcon, DiffPreviewIcon, MorePreviewIcon, OpenSystemIcon, RenderedPreviewIcon, SourcePreviewIcon } from "./icons.tsx";
import type { FilesTabsTranslate } from "./locales.ts";
import type { FilesPreviewMode, FilesPreviewState } from "./types.ts";

export function PreviewActions({ tabId, preview, controller, t, active }: {
  tabId: string; preview: FilesPreviewState; controller: FilesTabsController; t: FilesTabsTranslate; active: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const paths = controller.pathActions;
  const nativeOpenAvailable = useSyncExternalStore(paths.subscribe, paths.getSnapshot, paths.getSnapshot);
  const [compact, setCompact] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const menuId = `minke-files-actions-${tabId}`;
  useLayoutEffect(() => {
    const header = ref.current?.parentElement;
    const view = header?.ownerDocument.defaultView;
    if (!header || !view?.ResizeObserver) return;
    const update = () => {
      const width = header.getBoundingClientRect().width;
      if (width > 0) setCompact(width < 280);
    };
    update();
    const observer = new view.ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setOpen(false); }, [active, compact, preview.entry.path]);

  const modes: { id: FilesPreviewMode; label: string; icon: ReactNode; disabled?: boolean }[] = [];
  if (preview.result?.kind === "text") {
    if (filesDocumentKind(preview.entry.path) !== undefined) modes.push({
      id: "preview", label: t("files.preview.mode.preview"), icon: <RenderedPreviewIcon size={15} />, disabled: preview.result.truncated,
    });
    modes.push(
      { id: "source", label: t("files.preview.mode.source"), icon: <SourcePreviewIcon size={15} /> },
      { id: "diff", label: t("files.preview.mode.diff"), icon: <DiffPreviewIcon size={15} />, disabled: preview.result.truncated },
    );
  }
  const close = () => {
    if (preview.saving) return;
    const view = ref.current?.ownerDocument.defaultView;
    if (preview.dirty && view && !view.confirm(t("files.preview.discardConfirm", { name: preview.entry.name }))) return;
    setOpen(false);
    controller.closePreview(tabId);
  };
  const actions = nativeOpenAvailable ? [{
    id: "open-folder", label: t("files.preview.openFolder"), icon: <OpenSystemIcon size={15} />,
    create: () => controller.openContainingFolder(tabId, preview.entry.path),
  }] : [];
  const options: TabsCreateMenuOption[] = [
    ...modes.map(mode => ({ ...mode, checked: preview.mode === mode.id, group: t("files.preview.mode.group"), create: () => controller.setPreviewMode(tabId, mode.id) })),
    ...actions.map(action => ({ ...action, group: t("files.preview.actions") })),
  ];
  return <div ref={ref} className="minke-files-preview__actions" data-compact={compact || undefined}>
    {compact ? options.length > 0 && <button ref={setAnchor} type="button" data-minke-icon-button aria-label={t("files.preview.more")} title={t("files.preview.more")}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}><MorePreviewIcon size={15} /></button> : <>
      {modes.length > 0 && <div className="minke-files-preview__mode" role="group" aria-label={t("files.preview.mode.group")}>
        {modes.map(mode => <button key={mode.id} type="button" data-minke-icon-button aria-label={mode.label} title={mode.label}
          aria-pressed={preview.mode === mode.id} disabled={mode.disabled} onClick={() => controller.setPreviewMode(tabId, mode.id)}>{mode.icon}</button>)}
      </div>}
      {actions.map(action => <button key={action.id} type="button" data-minke-icon-button aria-label={action.label} title={action.label}
        onClick={action.create}>{action.icon}</button>)}
    </>}
    <button type="button" data-minke-icon-button aria-label={t("files.preview.close")} title={t("files.preview.close")}
      disabled={preview.saving} onClick={close}><ClosePreviewIcon size={15} /></button>
    <TabsCreateMenu anchor={anchor} context={{}} id={menuId} label={t("files.preview.more")} open={open && compact && active}
      onClose={() => setOpen(false)} onCreated={() => anchor?.focus({ preventScroll: true })} options={options} placement="right" />
  </div>;
}
