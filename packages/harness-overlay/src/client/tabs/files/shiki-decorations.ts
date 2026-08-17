import type {
  HighlightedFileCode,
  HighlightedToken,
} from "./syntax-highlight.ts";

function tokenStyle(token: HighlightedToken): string | undefined {
  const declarations: string[] = [];
  if (token.color !== undefined) {
    declarations.push(`color:${token.color}`);
  }
  if (token.backgroundColor !== undefined) {
    declarations.push(
      `background-color:${token.backgroundColor}`,
    );
  }
  const fontStyle = token.fontStyle ?? 0;
  if ((fontStyle & 1) !== 0) {
    declarations.push("font-style:italic");
  }
  if ((fontStyle & 2) !== 0) {
    declarations.push("font-weight:700");
  }
  const textDecorations: string[] = [];
  if ((fontStyle & 4) !== 0) {
    textDecorations.push("underline");
  }
  if ((fontStyle & 8) !== 0) {
    textDecorations.push("line-through");
  }
  if (textDecorations.length > 0) {
    declarations.push(
      `text-decoration:${textDecorations.join(" ")}`,
    );
  }
  return declarations.length === 0
    ? undefined
    : declarations.join(";");
}

export interface ShikiDecorationRange {
  readonly from: number;
  readonly to: number;
  readonly style: string;
}

/**
 * Maps Shiki's line-relative tokens back to exact CodeMirror offsets.
 * Explicit line starts keep CRLF and lone-CR documents aligned.
 */
export function shikiDecorationRanges(
  highlighted: HighlightedFileCode | undefined,
  documentLength: number,
): readonly ShikiDecorationRange[] {
  if (highlighted === undefined) return [];
  const ranges: ShikiDecorationRange[] = [];
  for (
    let lineIndex = 0;
    lineIndex < highlighted.lines.length;
    lineIndex += 1
  ) {
    const line = highlighted.lines[lineIndex] ?? [];
    let offset = highlighted.lineStarts[lineIndex] ?? 0;
    for (const token of line) {
      const start = offset;
      offset += token.content.length;
      const end = Math.min(offset, documentLength);
      const style = tokenStyle(token);
      if (
        style !== undefined &&
        start < end &&
        start < documentLength
      ) {
        ranges.push({ from: start, to: end, style });
      }
    }
  }
  return ranges;
}
