import {
  DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS,
} from "./contract.ts";

const FENCE_BALANCE_RESERVE = 64;
const PREFERRED_BREAK_WINDOW = 400;
const MAX_REOPEN_INFO_CHARACTERS = 48;

interface OpenFence {
  readonly character: "`" | "~";
  readonly info: string;
}

function characterCount(value: string): number {
  return [...value].length;
}

function preferredBreak(
  characters: readonly string[],
  maximum: number,
): number {
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
): string[] {
  const characters = [...text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    const available = characters.length - offset;
    if (available <= maximum) {
      chunks.push(characters.slice(offset).join(""));
      break;
    }
    const relativeBreak = preferredBreak(
      characters.slice(offset, offset + maximum),
      maximum,
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
 * Splits Discord Markdown without dropping source text. Synthetic fence
 * markers keep every rendered message independently balanced.
 */
export function splitDiscordMessageText(
  text: string,
): readonly string[] {
  if (typeof text !== "string" || text.length === 0) {
    return Object.freeze([]);
  }
  if (
    characterCount(text) <=
    DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS
  ) {
    return Object.freeze([text]);
  }
  const hasFence =
    /(?:^|\n)(?:`{3,}|~{3,})/u.test(text);
  const rawMaximum =
    DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS -
    (hasFence ? FENCE_BALANCE_RESERVE : 0);
  let fence: OpenFence | undefined;
  const chunks = rawChunks(text, rawMaximum).map(
    (raw): string => {
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
        characterCount(chunk) >
        DISCORD_MAX_MESSAGE_CONTENT_CHARACTERS
      ) {
        throw new TypeError(
          "Discord Markdown chunk exceeds 2000 characters",
        );
      }
      return chunk;
    },
  );
  return Object.freeze(chunks);
}
