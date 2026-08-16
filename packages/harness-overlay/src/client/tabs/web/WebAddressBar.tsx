import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  ManagedTab,
} from "../types.ts";
import type {
  WebTabsController,
} from "./controller.ts";
import {
  WebIcon,
} from "./icons.tsx";
import type {
  WebTabsTranslate,
} from "./locales.ts";
import type {
  WebTabPayload,
} from "./types.ts";

export interface WebAddressBarProps {
  tab: ManagedTab<WebTabPayload>;
  controller: WebTabsController;
  t: WebTabsTranslate;
}

/** Editable URL surface for the active Web tab toolbar. */
export function WebAddressBar({
  tab,
  controller,
  t,
}: WebAddressBarProps): ReactNode {
  const [draft, setDraft] = useState(tab.payload.url ?? "");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(tab.payload.url ?? "");
    setInvalid(false);
    if (tab.payload.url === undefined) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [tab.id, tab.payload.url]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const accepted = controller.navigate(tab.id, draft);
    setInvalid(!accepted);
    if (accepted) inputRef.current?.blur();
  };

  return (
    <form
      className="minke-tabs-location"
      onSubmit={submit}
      data-invalid={invalid || undefined}
    >
      <span className="minke-tabs-location__icon">
        <WebIcon size={15} />
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        enterKeyHint="go"
        value={draft}
        aria-label={t("web.address.label")}
        aria-invalid={invalid || undefined}
        title={tab.payload.url ?? t("web.address.placeholder")}
        placeholder={t("web.address.placeholder")}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (invalid) setInvalid(false);
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          setDraft(tab.payload.url ?? "");
          setInvalid(false);
        }}
      />
    </form>
  );
}
