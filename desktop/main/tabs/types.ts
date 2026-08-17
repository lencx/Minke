import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
} from "electron";

export interface ExternalTabOpener {
  openExternal(url: string): Promise<void>;
}

export interface ExternalPathOpener {
  openPath(path: string): Promise<string>;
}

export interface TabsBinding {
  dispose(): void;
}

export type TabsAuthorization = (
  event: IpcMainEvent | IpcMainInvokeEvent,
) => boolean;
