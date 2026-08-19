import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  FilesTabsController,
} from "./controller.ts";
import {
  FilesIcon,
  GitBranchIcon,
} from "./icons.tsx";
import type {
  FilesTabsTranslate,
} from "./locales.ts";
import type {
  FilesTab,
} from "./types.ts";

export function FileAddressBar(props: {
  readonly tab: FilesTab;
  readonly controller: FilesTabsController;
  readonly t: FilesTabsTranslate;
}): ReactNode {
  const [draft, setDraft] = useState(props.tab.payload.path ?? "");

  useEffect(() => {
    setDraft(props.tab.payload.path ?? "");
  }, [props.tab.payload.path]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const path = draft.trim();
    if (path === "") return;
    props.controller.navigate(props.tab.id, path);
  };

  return (
    <form
      className="minke-files-location"
      aria-label={props.t("files.path.label")}
      onSubmit={submit}
    >
      <span
        className="minke-files-location__icon"
        aria-hidden="true"
      >
        <FilesIcon size={13} />
      </span>
      <input
        value={draft}
        aria-label={props.t("files.path.label")}
        placeholder={props.t("files.path.placeholder")}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(props.tab.payload.path ?? "");
            event.currentTarget.blur();
          }
        }}
      />
      {props.tab.payload.repository !== undefined && (
        <span
          className="minke-files-location__branch"
          aria-label={props.t("files.git.branch", {
            branch: props.tab.payload.repository.branch,
          })}
          title={props.t("files.git.branch", {
            branch: props.tab.payload.repository.branch,
          })}
        >
          <GitBranchIcon size={12} />
          <span>{props.tab.payload.repository.branch}</span>
        </span>
      )}
    </form>
  );
}
