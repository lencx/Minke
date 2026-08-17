import type { ReactNode } from "react";

export interface TabInput<Payload = unknown> {
  /** Renderer family, for example "web" or "terminal". */
  readonly kind: string;
  /** Stable identity within the renderer family, used for deduplication. */
  readonly key: string;
  readonly title: string;
  readonly payload: Payload;
}

export interface ManagedTab<Payload = unknown>
  extends TabInput<Payload> {
  readonly id: string;
}

export interface TabsSnapshot {
  readonly tabs: readonly ManagedTab[];
  readonly activeId: string | undefined;
  readonly visible: boolean;
}

export interface TabsHost {
  showPanel(): void;
  hidePanel(): void;
}

export interface TabCreateContext {
  readonly cwd?: string;
}

export interface TabCreateOption {
  /** Stable identity across renderer updates; unique within the chooser. */
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly order?: number;
  create(context: TabCreateContext): void;
}

export interface TabRenderer {
  readonly kind: string;
  createOptions?(): readonly TabCreateOption[];
  renderIcon(tab: ManagedTab): ReactNode;
  renderLeadingActions?(
    tab: ManagedTab,
  ): ReactNode;
  renderTrailingActions?(
    tab: ManagedTab,
  ): ReactNode;
  renderToolbarCenter?(
    tab: ManagedTab,
  ): ReactNode;
  subtitle?(tab: ManagedTab): string | undefined;
  loading?(tab: ManagedTab): boolean;
  loadingLabel?(
    tab: ManagedTab,
  ): string;
  beforeClose?(tab: ManagedTab): boolean;
  renderView(
    tab: ManagedTab,
    active: boolean,
  ): ReactNode;
}
