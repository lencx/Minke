import {
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  DshDetailsPresentation,
} from "./contract.ts";
import type {
  DetailsTabsController,
} from "./controller.ts";
import type {
  DetailsPresentationRuntime,
} from "./presentation-runtime.ts";

export function DetailsPresentationAdapter({
  state,
  panel,
  controller,
  presentation,
}: DshDetailsPresentation & {
  readonly controller: DetailsTabsController;
  readonly presentation: DetailsPresentationRuntime;
}): ReactNode {
  const target = useSyncExternalStore(
    presentation.subscribe,
    presentation.getSnapshot,
    () => null,
  );

  useLayoutEffect(() => {
    controller.accept(state);
  }, [
    controller,
    state.callId,
    state.label,
    state.open,
    state.sessionId,
    state.title,
  ]);

  return target === null ? null : createPortal(panel, target);
}
