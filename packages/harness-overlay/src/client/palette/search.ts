import type { PaletteActionView } from "../runtime.ts";

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .trim();
}

function subsequenceScore(value: string, query: string): number | undefined {
  let queryIndex = 0;
  let firstIndex = -1;
  let previousIndex = -1;
  let gaps = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue;
    if (firstIndex < 0) firstIndex = index;
    if (previousIndex >= 0) gaps += index - previousIndex - 1;
    previousIndex = index;
    queryIndex += 1;
    if (queryIndex === query.length) {
      return 80 + firstIndex + gaps;
    }
  }
  return undefined;
}

function textScore(value: string, query: string): number | undefined {
  if (value === query) return 0;
  if (value.startsWith(query)) return 10 + value.length - query.length;

  const wordIndex = value.search(
    new RegExp(`(?:^|\\s)${escapeRegExp(query)}`, "u"),
  );
  if (wordIndex >= 0) return 20 + wordIndex;

  const containsIndex = value.indexOf(query);
  if (containsIndex >= 0) return 40 + containsIndex;
  return subsequenceScore(value, query);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function actionScore(
  action: PaletteActionView,
  query: string,
): number | undefined {
  const labelScore = textScore(normalize(action.label), query);
  let best = labelScore;
  for (const keyword of action.keywords) {
    const score = textScore(normalize(keyword), query);
    if (score === undefined) continue;
    const weighted = score + 15;
    if (best === undefined || weighted < best) best = weighted;
  }
  return best;
}

/** Filter and rank palette actions without changing their stable source order. */
export function searchPaletteActions(
  actions: readonly PaletteActionView[],
  query: string,
): readonly PaletteActionView[] {
  const normalizedQuery = normalize(query);
  if (normalizedQuery === "") return actions;

  return actions
    .flatMap((action, index) => {
      const score = actionScore(action, normalizedQuery);
      return score === undefined ? [] : [{ action, index, score }];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.action.order - right.action.order ||
        left.index - right.index,
    )
    .map(({ action }) => action);
}
