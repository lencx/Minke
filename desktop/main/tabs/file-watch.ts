import {
  watch as watchFileSystem,
  type FSWatcher,
} from "node:fs";
import {
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  parseFileManagerChangeEvent,
  parseFileManagerUnwatchRequest,
  parseFileManagerWatchRequest,
  type FileManagerChangeEvent,
  type FileManagerUnwatchRequest,
  type FileManagerWatchRequest,
} from "@minke/harness-overlay/tabs/files-contract.ts";

const FILE_WATCH_DEBOUNCE_MS = 80;

interface DirectoryWatcher {
  close(): void;
}

type WatchPath = (
  path: string,
  onChange: (path: string) => void,
  onError: () => void,
) => DirectoryWatcher;

interface FileWatchRuntimeOptions {
  readonly send: (event: FileManagerChangeEvent) => void;
  readonly watchPath?: WatchPath;
  readonly schedule?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  readonly cancelSchedule?: (
    timer: ReturnType<typeof setTimeout>,
  ) => void;
}

interface WatchSubscription {
  readonly id: string;
  readonly watchers: DirectoryWatcher[];
  readonly pendingPaths: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}

function normalizedAbsolutePath(path: string): string {
  if (!isAbsolute(path)) {
    throw new TypeError("file watch path must be absolute");
  }
  return resolve(path);
}

function closeWatcher(watcher: DirectoryWatcher): void {
  try {
    watcher.close();
  } catch {
    // A host watcher may already be closed after an operating-system error.
  }
}

function watchHostPath(
  path: string,
  onChange: (path: string) => void,
  onError: () => void,
): FSWatcher {
  const watcher = watchFileSystem(
    path,
    { persistent: false },
    (_eventType, filename) => {
      onChange(
        filename === null
          ? path
          : join(path, filename.toString()),
      );
    },
  );
  watcher.on("error", onError);
  return watcher;
}

/**
 * Owns the main-process filesystem watchers requested by one Harness window.
 */
export class FileWatchRuntime {
  readonly #send: FileWatchRuntimeOptions["send"];
  readonly #watchPath: WatchPath;
  readonly #schedule: NonNullable<
    FileWatchRuntimeOptions["schedule"]
  >;
  readonly #cancelSchedule: NonNullable<
    FileWatchRuntimeOptions["cancelSchedule"]
  >;
  readonly #subscriptions = new Map<
    string,
    WatchSubscription
  >();
  #disposed = false;

  constructor(options: FileWatchRuntimeOptions) {
    this.#send = options.send;
    this.#watchPath = options.watchPath ?? watchHostPath;
    this.#schedule =
      options.schedule ??
      ((callback, delay) => setTimeout(callback, delay));
    this.#cancelSchedule =
      options.cancelSchedule ?? clearTimeout;
  }

  watch(request: FileManagerWatchRequest): void {
    if (this.#disposed) return;
    const parsed = parseFileManagerWatchRequest(request);
    const paths = [...new Set(
      parsed.paths.map(normalizedAbsolutePath),
    )];
    this.unwatch({ id: parsed.id });
    const subscription: WatchSubscription = {
      id: parsed.id,
      watchers: [],
      pendingPaths: new Set(),
    };
    this.#subscriptions.set(parsed.id, subscription);

    for (const path of paths) {
      try {
        subscription.watchers.push(
          this.#watchPath(
            path,
            (changedPath) => {
              this.#queue(
                subscription,
                normalizedAbsolutePath(changedPath),
              );
            },
            () => this.#queue(subscription, path),
          ),
        );
      } catch {
        this.#queue(subscription, path);
      }
    }
  }

  unwatch(request: FileManagerUnwatchRequest): void {
    const { id } = parseFileManagerUnwatchRequest(request);
    const subscription = this.#subscriptions.get(id);
    if (subscription === undefined) return;
    this.#subscriptions.delete(id);
    if (subscription.timer !== undefined) {
      this.#cancelSchedule(subscription.timer);
      subscription.timer = undefined;
    }
    for (const watcher of subscription.watchers) {
      closeWatcher(watcher);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const id of [...this.#subscriptions.keys()]) {
      this.unwatch({ id });
    }
  }

  #queue(
    subscription: WatchSubscription,
    path: string,
  ): void {
    if (
      this.#disposed ||
      this.#subscriptions.get(subscription.id) !== subscription
    ) {
      return;
    }
    subscription.pendingPaths.add(path);
    if (subscription.timer !== undefined) {
      this.#cancelSchedule(subscription.timer);
    }
    subscription.timer = this.#schedule(() => {
      subscription.timer = undefined;
      if (
        this.#disposed ||
        this.#subscriptions.get(subscription.id) !== subscription ||
        subscription.pendingPaths.size === 0
      ) {
        return;
      }
      const paths = [...subscription.pendingPaths].sort();
      subscription.pendingPaths.clear();
      this.#send(
        parseFileManagerChangeEvent({
          id: subscription.id,
          paths,
        }),
      );
    }, FILE_WATCH_DEBOUNCE_MS);
  }
}
