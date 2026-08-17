import type {
  Text,
} from "@codemirror/state";
import {
  foldService,
} from "@codemirror/language";

export interface CodeFoldRange {
  readonly from: number;
  readonly to: number;
}

function indentationColumns(line: string): number {
  let columns = 0;
  for (const character of line) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
  }
  return columns;
}

function isBlockCloser(line: string): boolean {
  return /^(?:[}\])]|<\/|end\b|else\b|elif\b|except\b|finally\b|fi\b|done\b|esac\b)/iu
    .test(line.trimStart());
}

/**
 * Provides useful offline folding for formatted brace, markup, and
 * indentation-based files without loading a second syntax engine.
 */
export function indentationFoldRange(
  document: Text,
  lineStart: number,
  lineEnd: number,
): CodeFoldRange | null {
  const current = document.lineAt(lineStart);
  if (
    current.from !== lineStart ||
    current.to !== lineEnd ||
    current.text.trim() === ""
  ) {
    return null;
  }
  const baseIndent = indentationColumns(current.text);
  let firstNested:
    | ReturnType<Text["line"]>
    | undefined;
  for (
    let number = current.number + 1;
    number <= document.lines;
    number += 1
  ) {
    const line = document.line(number);
    if (line.text.trim() === "") continue;
    if (indentationColumns(line.text) <= baseIndent) {
      return null;
    }
    firstNested = line;
    break;
  }
  if (firstNested === undefined) return null;

  let lastNested = firstNested;
  for (
    let number = firstNested.number + 1;
    number <= document.lines;
    number += 1
  ) {
    const line = document.line(number);
    if (line.text.trim() === "") continue;
    if (indentationColumns(line.text) <= baseIndent) {
      const to = isBlockCloser(line.text)
        ? line.from
        : lastNested.to;
      return to > lineEnd ? { from: lineEnd, to } : null;
    }
    lastNested = line;
  }
  return lastNested.to > lineEnd
    ? { from: lineEnd, to: lastNested.to }
    : null;
}

export const indentationFolding = foldService.of(
  (state, lineStart, lineEnd) =>
    indentationFoldRange(
      state.doc,
      lineStart,
      lineEnd,
    ),
);
