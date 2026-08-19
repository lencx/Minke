export interface WorkspacePathOpener {
  openPath(path: string): Promise<void>;
}

export interface ConversationFilesTarget {
  openFile(path: string, title: string): string | undefined;
}

/**
 * Route Harness conversation file links into the Minke Files reader.
 *
 * The original workspace opener remains the fallback for unsupported paths
 * and is restored without overwriting a later interceptor.
 */
export function installConversationFileRouter(
  workspaces: WorkspacePathOpener,
  files: ConversationFilesTarget,
  title: () => string,
): () => void {
  const originalOpenPath = workspaces.openPath;
  const routedOpenPath = async (path: string): Promise<void> => {
    if (files.openFile(path, title()) !== undefined) return;
    await originalOpenPath.call(workspaces, path);
  };
  workspaces.openPath = routedOpenPath;
  return () => {
    if (workspaces.openPath === routedOpenPath) {
      workspaces.openPath = originalOpenPath;
    }
  };
}
