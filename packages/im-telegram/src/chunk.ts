import {
  TELEGRAM_MAX_RICH_MARKDOWN_CHARACTERS,
  TELEGRAM_MAX_TEXT_CHARACTERS,
} from "./contract.ts";

const FENCE_BALANCE_RESERVE = 64;
const MAX_REOPEN_INFO_CHARACTERS = 48;
const PREFERRED_BREAK_WINDOW = 400;

interface OpenFence {
  readonly character: "`" | "~";
  readonly info: string;
}

function richCharacterCount(value: string): number {
  return [...value].length;
}

function textCharacterCount(value: string): number {
  return value.length;
}

function preferredBreak(
  characters: readonly string[],
): number {
  const maximum = characters.length;
  const minimum = Math.max(
    1,
    maximum - PREFERRED_BREAK_WINDOW,
  );
  for (let index = maximum; index >= minimum; index -= 1) {
    if (
      characters[index - 1] === "\n" &&
      characters[index - 2] === "\n"
    ) {
      return index;
    }
  }
  for (let index = maximum; index >= minimum; index -= 1) {
    if (characters[index - 1] === "\n") return index;
  }
  for (let index = maximum; index >= minimum; index -= 1) {
    if (
      characters[index - 1] === " " ||
      characters[index - 1] === "\t"
    ) {
      return index;
    }
  }
  return maximum;
}

function rawChunks(
  text: string,
  maximum: number,
  measureCharacter: (character: string) => number,
): string[] {
  const characters = [...text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    let end = offset;
    let length = 0;
    while (end < characters.length) {
      const next = measureCharacter(characters[end] ?? "");
      if (length + next > maximum) break;
      length += next;
      end += 1;
    }
    if (end === characters.length) {
      chunks.push(characters.slice(offset).join(""));
      break;
    }
    if (end === offset) {
      throw new TypeError(
        "Telegram chunk limit cannot contain one character",
      );
    }
    const relativeBreak = preferredBreak(
      characters.slice(offset, end),
    );
    chunks.push(
      characters
        .slice(offset, offset + relativeBreak)
        .join(""),
    );
    offset += relativeBreak;
  }
  return chunks;
}

function fenceInfo(value: string): string {
  return [
    ...value
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .trim(),
  ]
    .slice(0, MAX_REOPEN_INFO_CHARACTERS)
    .join("");
}

function scanFenceState(
  text: string,
  initial: OpenFence | undefined,
): OpenFence | undefined {
  let state = initial;
  const pattern = /(?:^|\n)(`{3,}|~{3,})([^\n]*)/gu;
  for (const match of text.matchAll(pattern)) {
    const marker = match[1];
    const suffix = match[2] ?? "";
    const character = marker?.[0];
    if (character !== "`" && character !== "~") {
      continue;
    }
    if (state === undefined) {
      state = {
        character,
        info: fenceInfo(suffix),
      };
      continue;
    }
    if (
      state.character === character &&
      suffix.trim().length === 0
    ) {
      state = undefined;
    }
  }
  return state;
}

function opener(fence: OpenFence): string {
  return `${fence.character.repeat(3)}${fence.info}\n`;
}

function closer(
  text: string,
  fence: OpenFence,
): string {
  return `${text.endsWith("\n") ? "" : "\n"}${fence.character.repeat(3)}`;
}

/**
 * Split raw Rich Message Markdown without dropping source content. Synthetic
 * fence markers make every rich-message chunk independently parseable.
 */
export function splitTelegramRichMarkdown(
  markdown: string,
): readonly string[] {
  if (typeof markdown !== "string" || markdown.length === 0) {
    return Object.freeze([]);
  }
  if (
    richCharacterCount(markdown) <=
    TELEGRAM_MAX_RICH_MARKDOWN_CHARACTERS
  ) {
    return Object.freeze([markdown]);
  }
  const hasFence =
    /(?:^|\n)(?:`{3,}|~{3,})/u.test(markdown);
  const rawMaximum =
    TELEGRAM_MAX_RICH_MARKDOWN_CHARACTERS -
    (hasFence ? FENCE_BALANCE_RESERVE : 0);
  let fence: OpenFence | undefined;
  const chunks = rawChunks(
    markdown,
    rawMaximum,
    () => 1,
  ).map((raw): string => {
    const startingFence = fence;
    fence = scanFenceState(raw, fence);
    const prefix =
      startingFence === undefined
        ? ""
        : opener(startingFence);
    const suffix =
      fence === undefined ? "" : closer(raw, fence);
    const chunk = `${prefix}${raw}${suffix}`;
    if (
      richCharacterCount(chunk) >
      TELEGRAM_MAX_RICH_MARKDOWN_CHARACTERS
    ) {
      throw new TypeError(
        "Telegram Rich Markdown chunk exceeds 32768 characters",
      );
    }
    return chunk;
  });
  return Object.freeze(chunks);
}

/**
 * Split plain Telegram text by UTF-16 code units while preserving every source
 * character and preferring paragraph, line, and word boundaries.
 */
export function splitTelegramText(
  text: string,
): readonly string[] {
  if (typeof text !== "string" || text.length === 0) {
    return Object.freeze([]);
  }
  if (
    textCharacterCount(text) <=
    TELEGRAM_MAX_TEXT_CHARACTERS
  ) {
    return Object.freeze([text]);
  }
  return Object.freeze(
    rawChunks(
      text,
      TELEGRAM_MAX_TEXT_CHARACTERS,
      (character) => character.length,
    ),
  );
}
