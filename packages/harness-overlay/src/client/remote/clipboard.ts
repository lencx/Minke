export interface RemoteClipboard {
  writeText(value: string): Promise<void>;
}

/** Copy a validated renderer-facing remote URL without leaking failures. */
export async function copyRemoteAddress(
  address: string,
  clipboard: RemoteClipboard | undefined =
    globalThis.navigator?.clipboard,
  documentValue: Document | undefined = globalThis.document,
): Promise<boolean> {
  if (address === "") return false;
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(address);
      return true;
    } catch {
      // A focused or secure-context gate can reject the modern API.
    }
  }
  if (documentValue === undefined) return false;

  const textarea = documentValue.createElement("textarea");
  const previousFocus = documentValue.activeElement as
    | HTMLElement
    | null;
  const selection = documentValue.getSelection();
  const ranges: Range[] = [];
  if (selection !== null) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index));
    }
  }
  textarea.value = address;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -1000px";
  textarea.style.opacity = "0";
  documentValue.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, address.length);

  try {
    return documentValue.execCommand("copy");
  } catch {
    return false;
  } finally {
    documentValue.body.removeChild(textarea);
    if (selection !== null) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    if (
      previousFocus?.isConnected &&
      typeof previousFocus.focus === "function"
    ) {
      previousFocus.focus({ preventScroll: true });
    }
  }
}
