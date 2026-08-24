export interface ConversationOutlineContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
}

export interface ConversationOutlineNode {
  readonly key?: unknown;
  readonly kind?: unknown;
  readonly data?: {
    readonly content?: readonly ConversationOutlineContentBlock[];
  };
}

export interface ConversationOutlineNodeLookup {
  get(key: string): ConversationOutlineNode | undefined;
}

export interface ConversationOutlineLabels {
  readonly image: string;
  readonly nonText: string;
}

export interface ConversationOutlineItem {
  readonly key: string;
  readonly preview: string;
  readonly markerWidth: number;
}

const PREVIEW_LIMIT = 360;
const MIN_MARKER_WIDTH = 8;
const MAX_MARKER_WIDTH = 14;

function normalizePreview(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function truncatePreview(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= PREVIEW_LIMIT) return value;
  return `${characters.slice(0, PREVIEW_LIMIT - 1).join("")}…`;
}

/** Project durable message blocks into a bounded, readable hover preview. */
export function messagePreview(
  content: readonly ConversationOutlineContentBlock[],
  labels: ConversationOutlineLabels,
): string {
  const parts = content.flatMap((block) => {
    if (block.type === "image") return [labels.image];
    return typeof block.text === "string" ? [block.text] : [];
  });
  const normalized = normalizePreview(parts.join("\n"));
  return truncatePreview(
    normalized === "" ? labels.nonText : normalized,
  );
}

/** Encode message length as a quiet visual cue without changing hit targets. */
export function markerWidthForPreview(preview: string): number {
  const length = Array.from(preview).length;
  return Math.min(
    MAX_MARKER_WIDTH,
    MIN_MARKER_WIDTH + Math.round(Math.log2(length + 1)),
  );
}

/** Select ordinary and steering user messages from the loaded Chat window. */
export function conversationOutlineItems(
  order: readonly string[],
  nodes: ConversationOutlineNodeLookup,
  labels: ConversationOutlineLabels,
): readonly ConversationOutlineItem[] {
  return order.flatMap((key) => {
    const node = nodes.get(key);
    if (
      node === undefined ||
      (node.kind !== "user" && node.kind !== "steering")
    ) {
      return [];
    }
    const content = node.data?.content ?? [];
    const preview = messagePreview(content, labels);
    return [{
      key: typeof node.key === "string" ? node.key : key,
      preview,
      markerWidth: markerWidthForPreview(preview),
    }];
  });
}
