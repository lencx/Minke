import {
  parseRemoteHubCommand,
  parseRemoteHubSnapshot,
  REMOTE_HUB_COMMAND_CHANNEL,
  REMOTE_HUB_READ_CHANNEL,
  type RemoteHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";

interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface RemoteHubHostRuntime {
  dispatch(value: unknown): Promise<RemoteHubSnapshot>;
  getSnapshot(): RemoteHubSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface RemoteHubBinding {
  dispose(): void;
}

/** Bind the local-only Remote Hub command surface to an authorized window. */
export function bindRemoteHubIpc(
  ipcMain: IpcMainLike,
  runtime: RemoteHubHostRuntime,
  publish: (snapshot: RemoteHubSnapshot) => void,
  authorize: (event: unknown) => boolean,
): RemoteHubBinding {
  ipcMain.handle(REMOTE_HUB_READ_CHANNEL, (event) => {
    assertAuthorized(authorize, event);
    return parseRemoteHubSnapshot(runtime.getSnapshot());
  });
  ipcMain.handle(
    REMOTE_HUB_COMMAND_CHANNEL,
    async (event, value) => {
      assertAuthorized(authorize, event);
      return parseRemoteHubSnapshot(
        await runtime.dispatch(parseRemoteHubCommand(value)),
      );
    },
  );
  const unsubscribe = runtime.subscribe(() => {
    publish(parseRemoteHubSnapshot(runtime.getSnapshot()));
  });
  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      ipcMain.removeHandler(REMOTE_HUB_READ_CHANNEL);
      ipcMain.removeHandler(REMOTE_HUB_COMMAND_CHANNEL);
    },
  });
}

function assertAuthorized(
  authorize: (event: unknown) => boolean,
  event: unknown,
): void {
  if (!authorize(event)) {
    throw new Error("unauthorized Remote Hub request");
  }
}
