/**
 * Minke's process adapter for DSH's public runProfile interface.
 * Quit inspection follows DSH Desktop. The Web profile supplies the browser
 * entry for Minke's Electron window and Remote Access.
 */

/** Count the same interruptible work as DSH Desktop's quit/update inspector. */
export async function inspectDesktopTasks(ctx) {
  const agents = ctx.get("agents");
  const jobs = ctx.get("jobs");
  if (agents === undefined || jobs === undefined) {
    throw new Error("Desktop task services are unavailable");
  }
  const liveAgents = agents.list();
  const activeTasks = liveAgents.some(agent => agent.status === "running" ||
    agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) ||
    [undefined, ...liveAgents].some(agent => jobs.list(agent?.id)
      .some(job => job.status === "running" || job.status === "stopping"));
  let scheduledTasks = false;
  for (const agent of liveAgents) {
    const activity = await ctx.waterfall("workspace/session-activity",
      { sessionId: agent.id }, () => Promise.resolve([]));
    if (activity.some(entry => entry.kind === "schedule")) {
      scheduledTasks = true;
      break;
    }
  }
  return { activeTasks, scheduledTasks };
}

/** Own the private parent channel through boot, inspection, and profile disposal. */
export async function runDesktopHost(boot, channel = process) {
  if (!channel.connected) return;
  const send = message => new Promise((resolve, reject) => {
    if (!channel.connected || channel.send === undefined) { resolve(); return; }
    channel.send(message, error => error == null ? resolve() : reject(error));
  });
  let running;
  let stopping;
  const application = Promise.resolve().then(boot);
  const stop = () => stopping ??= (async () => {
    const applicationResult = await application.catch(() => undefined);
    if (applicationResult !== undefined) {
      await applicationResult.shutdown.shutdown(0);
      await send({ type: "shutdown-complete" });
    }
    if (channel.connected) channel.disconnect();
  })();
  const onMessage = message => {
    if (typeof message !== "object" || message === null) return;
    if (message.type === "shutdown") {
      void stop().catch(error => { console.error(error); channel.exitCode = 1; });
      return;
    }
    if (message.type !== "quit-inspection" || !Number.isSafeInteger(message.requestId)) return;
    void (async () => {
      try {
        if (running === undefined || stopping !== undefined) throw new Error("Desktop Host is unavailable");
        const inspection = await inspectDesktopTasks(running.ctx);
        if (stopping !== undefined) throw new Error("Desktop Host is stopping");
        await send({ type: "quit-inspection", requestId: message.requestId, ...inspection });
      } catch (error) {
        await send({ type: "quit-inspection", requestId: message.requestId,
          activeTasks: true, scheduledTasks: false,
          error: error instanceof Error ? error.message : String(error) });
      }
    })().catch(error => console.error(error));
  };
  const onDisconnect = () => { void stop().catch(error => { console.error(error); channel.exitCode = 1; }); };
  channel.on("message", onMessage);
  channel.once("disconnect", onDisconnect);
  try {
    running = await application;
    if (stopping !== undefined || !channel.connected) { await stop(); return; }
    const { ctx } = running;
    const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`;
    const entries = [];
    ctx.emit(ctx.webServer, "webserver/entry-url", origin, entries);
    const entry = entries.find(candidate => candidate.open && new URL(candidate.url).origin === origin);
    if (entry === undefined) throw new Error("DSH Web did not publish a loopback browser entry");
    await send({ type: "ready", url: entry.url });
  } catch (error) {
    channel.off("message", onMessage);
    channel.off("disconnect", onDisconnect);
    if (running !== undefined) await stop().catch(failure => console.error(failure));
    throw error;
  }
}
