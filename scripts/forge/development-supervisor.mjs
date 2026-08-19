import { once } from "node:events";

/**
 * Supervise Electron without owning Forge's Vite servers. The `restarted`
 * marker tells Forge plugins not to tear those servers down with each child.
 */
export async function superviseForgeDevelopment({
  input,
  restartExitCode,
  start,
}) {
  for (;;) {
    const child = await start();
    child.restarted = true;
    let interactiveRestart = false;
    const restartFromInput = (data) => {
      if (String(data).trim() !== "rs") return;
      interactiveRestart = true;
      child.kill("SIGTERM");
    };
    input?.on("data", restartFromInput);

    let code;
    let signal;
    try {
      [code, signal] = await once(child, "exit");
    } finally {
      input?.off("data", restartFromInput);
    }

    if (interactiveRestart || code === restartExitCode) continue;
    return { code, signal };
  }
}
