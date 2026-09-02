import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SqliteAgentBrowserHistory,
  agentBrowserHistoryFilePath,
} from "@minke/desktop/main/agent-browser/index.ts";

test("Agent Browser history persists visits and aggregates identical paths", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const path = agentBrowserHistoryFilePath(directory);
  const history = new SqliteAgentBrowserHistory({ path });

  history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "agent-session-1",
    url: "https://Example.com/items/42?source=agent#summary",
    visitedAt: 1_000,
  });
  history.recordVisit({
    actor: "human",
    navigationKind: "same-document",
    sessionId: "agent-session-1",
    url: "https://example.com/items/42?source=human#comments",
    visitedAt: 2_000,
  });
  history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "agent-session-2",
    url: "https://example.com/other",
    visitedAt: 3_000,
  });

  const snapshot = history.read({ limit: 20 });
  assert.deepEqual(
    {
      agentVisits: snapshot.agentVisits,
      humanVisits: snapshot.humanVisits,
      retainedVisits: snapshot.retainedVisits,
      totalVisits: snapshot.totalVisits,
      uniquePaths: snapshot.uniquePaths,
    },
    {
      agentVisits: 2,
      humanVisits: 1,
      retainedVisits: 3,
      totalVisits: 3,
      uniquePaths: 2,
    },
  );
  assert.deepEqual(
    snapshot.visits.map((visit) => ({
      actor: visit.actor,
      navigationKind: visit.navigationKind,
      pathAgentVisits: visit.pathAgentVisits,
      pathHumanVisits: visit.pathHumanVisits,
      pathname: visit.pathname,
      pathVisitCount: visit.pathVisitCount,
      url: visit.url,
      visitedAt: visit.visitedAt,
    })),
    [
      {
        actor: "agent",
        navigationKind: "document",
        pathAgentVisits: 1,
        pathHumanVisits: 0,
        pathname: "/other",
        pathVisitCount: 1,
        url: "https://example.com/other",
        visitedAt: 3_000,
      },
      {
        actor: "human",
        navigationKind: "same-document",
        pathAgentVisits: 1,
        pathHumanVisits: 1,
        pathname: "/items/42",
        pathVisitCount: 2,
        url: "https://example.com/items/42?source=human#comments",
        visitedAt: 2_000,
      },
      {
        actor: "agent",
        navigationKind: "document",
        pathAgentVisits: 1,
        pathHumanVisits: 1,
        pathname: "/items/42",
        pathVisitCount: 2,
        url: "https://example.com/items/42?source=agent#summary",
        visitedAt: 1_000,
      },
    ],
  );
  assert.deepEqual(
    history.read({ actor: "human", limit: 20 }).visits
      .map(({ actor, pathname }) => ({ actor, pathname })),
    [{ actor: "human", pathname: "/items/42" }],
  );
  history.close();

  const reopened = new SqliteAgentBrowserHistory({ path });
  assert.equal(reopened.read({ limit: 20 }).totalVisits, 3);
  reopened.clear();
  assert.deepEqual(reopened.read({ limit: 20 }), {
    agentVisits: 0,
    humanVisits: 0,
    retainedVisits: 0,
    totalVisits: 0,
    uniquePaths: 0,
    visits: [],
  });
  reopened.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "agent-session-after-clear",
    url: "https://example.com/fresh",
    visitedAt: 4_000,
  });
  assert.equal(
    reopened.read({ limit: 20 }).visits[0].visitId,
    1,
  );
  reopened.close();
});

test("Agent Browser history path stays inside the desktop user-data root", () => {
  assert.equal(
    agentBrowserHistoryFilePath("/tmp/minke-user-data"),
    "/tmp/minke-user-data/agent-browser/history.sqlite",
  );
});

test("Agent Browser history prunes only the event timeline", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-retention-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const history = new SqliteAgentBrowserHistory({
    path: agentBrowserHistoryFilePath(directory),
    maxRetainedVisits: 2,
  });
  for (let index = 1; index <= 3; index += 1) {
    history.recordVisit({
      actor: index === 2 ? "human" : "agent",
      navigationKind: "document",
      sessionId: "agent-retention",
      url: `https://example.com/docs?visit=${String(index)}`,
      visitedAt: index * 1_000,
    });
  }

  const snapshot = history.read({ limit: 20 });
  assert.equal(snapshot.totalVisits, 3);
  assert.equal(snapshot.retainedVisits, 2);
  assert.equal(snapshot.uniquePaths, 1);
  assert.deepEqual(
    snapshot.visits.map(
      ({ visitedAt, pathVisitCount }) => ({
        visitedAt,
        pathVisitCount,
      }),
    ),
    [
      { visitedAt: 3_000, pathVisitCount: 3 },
      { visitedAt: 2_000, pathVisitCount: 3 },
    ],
  );
  history.close();
  history.close();
});
