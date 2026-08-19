import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  EditorState,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import {
  basicSetup,
} from "codemirror";
import {
  unifiedMergeView,
} from "@codemirror/merge";
import {
  highlightFileCode,
  type HighlightedFileCode,
} from "./syntax-highlight.ts";
import {
  shikiDecorationRanges,
} from "./shiki-decorations.ts";
import {
  indentationFolding,
} from "./code-folding.ts";

const setShikiDecorations =
  StateEffect.define<DecorationSet>();

const shikiDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setShikiDecorations)) {
        next = effect.value;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function highlightedDecorations(
  highlighted: HighlightedFileCode | undefined,
  documentLength: number,
): DecorationSet {
  const ranges: Range<Decoration>[] = shikiDecorationRanges(
    highlighted,
    documentLength,
  ).map(({ from, to, style }) =>
    Decoration.mark({
      attributes: {
        "data-shiki-token": "",
        style,
      },
    }).range(from, to));
  return Decoration.set(ranges, true);
}

export function CodeMirrorEditor(props: {
  readonly path: string;
  readonly value: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly diffOriginal?: string;
  readonly active: boolean;
  readonly onChange: (content: string) => void;
  readonly onSave: () => void;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const synchronizingRef = useRef(false);
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  onChangeRef.current = props.onChange;
  onSaveRef.current = props.onSave;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let disposed = false;
    let highlightGeneration = 0;
    let highlightTimer:
      | ReturnType<typeof setTimeout>
      | undefined;
    let view: EditorView;

    const highlight = async (): Promise<void> => {
      const generation = ++highlightGeneration;
      const content = view.state.doc.toString();
      const highlighted = await highlightFileCode(
        props.path,
        content,
      );
      if (
        disposed ||
        generation !== highlightGeneration ||
        view.state.doc.toString() !== content
      ) {
        return;
      }
      view.dispatch({
        effects: setShikiDecorations.of(
          highlightedDecorations(
            highlighted,
            view.state.doc.length,
          ),
        ),
      });
    };
    const scheduleHighlight = (delay: number): void => {
      if (highlightTimer !== undefined) {
        clearTimeout(highlightTimer);
      }
      highlightTimer = setTimeout(() => {
        highlightTimer = undefined;
        void highlight();
      }, delay);
    };

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          indentationFolding,
          shikiDecorations,
          ...(props.diffOriginal === undefined
            ? []
            : unifiedMergeView({
                original: props.diffOriginal,
                highlightChanges: true,
                gutter: true,
                allowInlineDiffs: true,
                mergeControls: false,
                collapseUnchanged: {
                  margin: 3,
                  minSize: 8,
                },
              })),
          EditorState.readOnly.of(props.readOnly),
          EditorView.editable.of(!props.readOnly),
          EditorView.contentAttributes.of({
            "aria-label": props.label,
            "data-highlighter": "shiki",
          }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (!synchronizingRef.current) {
              onChangeRef.current(
                update.state.doc.toString(),
              );
            }
            scheduleHighlight(120);
          }),
        ],
      }),
    });
    viewRef.current = view;
    scheduleHighlight(0);
    return () => {
      disposed = true;
      highlightGeneration += 1;
      if (highlightTimer !== undefined) {
        clearTimeout(highlightTimer);
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [
    props.diffOriginal,
    props.label,
    props.path,
    props.readOnly,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (
      view === null ||
      view.state.doc.toString() === props.value
    ) {
      return;
    }
    synchronizingRef.current = true;
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: props.value,
        },
      });
    } finally {
      synchronizingRef.current = false;
    }
  }, [props.value]);

  useEffect(() => {
    if (props.active) {
      viewRef.current?.requestMeasure();
    }
  }, [props.active]);

  return (
    <div
      ref={hostRef}
      className="minke-files-preview__editor"
      data-editor="codemirror"
      data-highlighter="shiki"
      data-line-numbers="true"
      data-code-folding="true"
      data-mode={
        props.diffOriginal === undefined ? "source" : "diff"
      }
    />
  );
}
