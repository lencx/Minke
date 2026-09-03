import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  SqliteAgentBrowserHistory,
  agentBrowserHistoryFilePath,
} from "@minke/desktop/main/agent-browser/index.ts";

async function createVersionOneHistoryDatabase(path) {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE visits (
        visit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        url TEXT NOT NULL,
        origin TEXT NOT NULL,
        pathname TEXT NOT NULL,
        path_key TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('agent', 'human')),
        navigation_kind TEXT NOT NULL CHECK (
          navigation_kind IN ('document', 'same-document')
        ),
        visited_at INTEGER NOT NULL CHECK (visited_at >= 0)
      ) STRICT;
      CREATE TABLE path_stats (
        path_key TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        pathname TEXT NOT NULL,
        visit_count INTEGER NOT NULL CHECK (visit_count > 0),
        agent_visit_count INTEGER NOT NULL
          CHECK (agent_visit_count >= 0),
        human_visit_count INTEGER NOT NULL
          CHECK (human_visit_count >= 0),
        first_visited_at INTEGER NOT NULL CHECK (first_visited_at >= 0),
        last_visited_at INTEGER NOT NULL CHECK (last_visited_at >= 0),
        last_url TEXT NOT NULL,
        CHECK (
          agent_visit_count + human_visit_count = visit_count
        )
      ) STRICT;
      INSERT INTO visits (
        session_id,
        url,
        origin,
        pathname,
        path_key,
        actor,
        navigation_kind,
        visited_at
      ) VALUES (
        'web:legacy',
        'https://www.google.com/search?q=legacy+query',
        'https://www.google.com',
        '/search',
        'https://www.google.com/search',
        'human',
        'document',
        1000
      );
      INSERT INTO path_stats (
        path_key,
        origin,
        pathname,
        visit_count,
        agent_visit_count,
        human_visit_count,
        first_visited_at,
        last_visited_at,
        last_url
      ) VALUES (
        'https://www.google.com/search',
        'https://www.google.com',
        '/search',
        1,
        0,
        1,
        1000,
        1000,
        'https://www.google.com/search?q=legacy+query'
      );
      PRAGMA user_version = 1;
    `);
  } finally {
    database.close();
  }
}

async function createVersionTwoHistoryDatabase(path) {
  await createVersionOneHistoryDatabase(path);
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      ALTER TABLE visits ADD COLUMN title TEXT;
      UPDATE visits SET title = 'Legacy v2 search';
      PRAGMA user_version = 2;
    `);
  } finally {
    database.close();
  }
}

function readPathStats(path, pathKey) {
  const database = new DatabaseSync(path);
  try {
    const stats = database.prepare(`
      SELECT
        visit_count,
        agent_visit_count,
        human_visit_count,
        first_visited_at,
        last_visited_at,
        last_url
      FROM path_stats
      WHERE path_key = ?
    `).get(pathKey);
    if (stats === undefined) return undefined;
    return {
      agentVisitCount: Number(stats.agent_visit_count),
      firstVisitedAt: Number(stats.first_visited_at),
      humanVisitCount: Number(stats.human_visit_count),
      lastUrl: stats.last_url,
      lastVisitedAt: Number(stats.last_visited_at),
      visitCount: Number(stats.visit_count),
    };
  } finally {
    database.close();
  }
}

test("Agent Browser history persists visits, aggregates paths, and keeps ids monotonic", async (t) => {
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
    4,
  );
  reopened.close();
});

test("Agent Browser history path stays inside the desktop user-data root", () => {
  assert.equal(
    agentBrowserHistoryFilePath("/tmp/minke-user-data"),
    join(
      "/tmp/minke-user-data",
      "agent-browser",
      "history.sqlite",
    ),
  );
});

test("Agent Browser history stores page titles and derives Minke search queries", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-title-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const history = new SqliteAgentBrowserHistory({
    path: agentBrowserHistoryFilePath(directory),
  });

  const visitId = history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "web:42",
    title: "hello world - Google Search",
    url: "https://www.google.com/search?q=hello+world&source=minke",
    visitedAt: 5_000,
  });
  assert.equal(visitId, 1);
  history.updateVisitTitle(visitId, "Updated search title");

  assert.deepEqual(
    history.read({ limit: 10 }).visits.map(
      ({ searchQuery, title, url }) => ({
        searchQuery,
        title,
        url,
      }),
    ),
    [{
      searchQuery: "hello world",
      title: "Updated search title",
      url: "https://www.google.com/search?q=hello+world&source=minke",
    }],
  );
  history.close();
});

test("Agent Browser history migrates v1 databases without losing visits", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-v1-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const path = agentBrowserHistoryFilePath(directory);
  await createVersionOneHistoryDatabase(path);

  const history = new SqliteAgentBrowserHistory({ path });
  assert.deepEqual(history.read({ limit: 10 }).visits, [{
    visitId: 1,
    visitedAt: 1_000,
    actor: "human",
    navigationKind: "document",
    url: "https://www.google.com/search?q=legacy+query",
    searchQuery: "legacy query",
    origin: "https://www.google.com",
    pathname: "/search",
    pathKey: "https://www.google.com/search",
    pathVisitCount: 1,
    pathAgentVisits: 0,
    pathHumanVisits: 1,
  }]);
  const visitId = history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "agent-after-migration",
    title: "Fresh title",
    url: "https://example.com/fresh",
    visitedAt: 2_000,
  });
  assert.equal(visitId, 2);
  history.close();

  const reopened = new SqliteAgentBrowserHistory({ path });
  assert.equal(reopened.read({ limit: 10 }).visits[0].title, "Fresh title");
  reopened.close();
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

test("Agent Browser history migrates v2 databases and backfills searchable queries", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-v2-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const path = agentBrowserHistoryFilePath(directory);
  await createVersionTwoHistoryDatabase(path);

  const history = new SqliteAgentBrowserHistory({ path });
  assert.equal(
    history.read({
      limit: 10,
      query: "legacy query",
    }).visits[0]?.title,
    "Legacy v2 search",
  );
  history.close();

  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      database.prepare("PRAGMA user_version").get().user_version,
      3,
    );
    assert.equal(
      database.prepare(`
        SELECT search_query
        FROM visits
        WHERE visit_id = 1
      `).get().search_query,
      "legacy query",
    );
    assert.deepEqual(
      database.prepare(`
        SELECT origin, favicon_url
        FROM site_icons
      `).all(),
      [],
    );
  } finally {
    database.close();
  }
});

test("Agent Browser history paginates with a stable timestamp and visit-id cursor", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-pages-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const history = new SqliteAgentBrowserHistory({
    path: agentBrowserHistoryFilePath(directory),
  });
  for (let index = 1; index <= 205; index += 1) {
    history.recordVisit({
      actor: index % 2 === 0 ? "human" : "agent",
      navigationKind: "document",
      sessionId: "history-pages",
      title: `History entry ${String(index)}`,
      url: `https://example.com/items/${String(index)}`,
      visitedAt: 10_000,
    });
  }

  const first = history.read({ limit: 100 });
  assert.equal(first.visits.length, 100);
  assert.deepEqual(first.nextCursor, {
    visitId: 106,
    visitedAt: 10_000,
  });

  const insertedAfterFirstPage = history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-pages",
    url: "https://example.com/new-after-page-one",
    visitedAt: 10_000,
  });
  assert.equal(insertedAfterFirstPage, 206);

  const second = history.read({
    before: first.nextCursor,
    limit: 100,
  });
  const third = history.read({
    before: second.nextCursor,
    limit: 100,
  });
  assert.deepEqual(
    [
      ...first.visits,
      ...second.visits,
      ...third.visits,
    ].map((visit) => visit.visitId),
    Array.from(
      { length: 205 },
      (_value, index) => 205 - index,
    ),
  );
  assert.equal(second.visits.length, 100);
  assert.equal(third.visits.length, 5);
  assert.equal(third.nextCursor, undefined);

  const humanFirst = history.read({
    actor: "human",
    limit: 40,
  });
  const humanSecond = history.read({
    actor: "human",
    before: humanFirst.nextCursor,
    limit: 40,
  });
  assert.equal(
    [...humanFirst.visits, ...humanSecond.visits]
      .every((visit) => visit.actor === "human"),
    true,
  );
  assert.equal(humanSecond.visits.length, 40);
  history.close();
});

test("Agent Browser history filters before paging and treats LIKE metacharacters literally", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-search-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const history = new SqliteAgentBrowserHistory({
    path: agentBrowserHistoryFilePath(directory),
  });
  history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-search",
    title: "Ordinary result",
    url: "https://example.com/ordinary",
    visitedAt: 1_000,
  });
  history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "history-search",
    title: "Release 100%_ready",
    url: "https://example.com/release",
    visitedAt: 2_000,
  });
  history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-search",
    title: "Search result",
    url: "https://www.google.com/search?q=hello+world",
    visitedAt: 3_000,
  });

  assert.deepEqual(
    history.read({
      limit: 1,
      query: "hello world",
    }).visits.map((visit) => visit.searchQuery),
    ["hello world"],
  );
  assert.deepEqual(
    history.read({
      actor: "agent",
      limit: 1,
      query: "100%_ready",
    }).visits.map((visit) => visit.title),
    ["Release 100%_ready"],
  );
  assert.equal(
    history.read({
      actor: "human",
      limit: 10,
      query: "100%_ready",
    }).visits.length,
    0,
  );
  history.close();
});

test("Agent Browser history caches safe favicons per origin and clears them with visits", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-icons-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const history = new SqliteAgentBrowserHistory({
    path: agentBrowserHistoryFilePath(directory),
  });
  const firstVisit = history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-icons",
    url: "https://example.com/first",
    visitedAt: 1_000,
  });
  history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "history-icons",
    url: "https://example.com/second",
    visitedAt: 2_000,
  });
  history.updateVisitFavicon(
    firstVisit,
    "https://example.com/first",
    "https://example.com/example-icon.png",
  );
  assert.deepEqual(
    history.read({ limit: 10 }).visits.map(
      (visit) => visit.faviconUrl,
    ),
    [
      "https://example.com/example-icon.png",
      "https://example.com/example-icon.png",
    ],
  );

  history.updateVisitFavicon(
    firstVisit,
    "https://wrong.example/first",
    "https://wrong.example/icon.png",
  );
  assert.equal(
    history.read({ limit: 1 }).visits[0]?.faviconUrl,
    "https://example.com/example-icon.png",
  );
  history.updateVisitFavicon(
    firstVisit,
    "https://example.com/first",
    "https://cdn.example.net/cross-origin.png",
  );
  assert.equal(
    history.read({ limit: 1 }).visits[0]?.faviconUrl,
    "https://example.com/favicon.ico",
  );
  history.updateVisitFavicon(
    firstVisit,
    "https://example.com/first",
    "data:image/png;base64,unsafe",
  );
  assert.equal(
    history.read({ limit: 1 }).visits[0]?.faviconUrl,
    "https://example.com/favicon.ico",
  );

  history.clear();
  history.updateVisitFavicon(
    firstVisit,
    "https://example.com/first",
    "https://example.com/stale.png",
  );
  history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-icons",
    url: "https://example.com/after-clear",
    visitedAt: 3_000,
  });
  assert.equal(
    history.read({ limit: 1 }).visits[0]?.faviconUrl,
    undefined,
  );
  history.close();
});

test("Agent Browser history rebuilds raw path metadata after deleting boundary visits", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-delete-metadata-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const path = agentBrowserHistoryFilePath(directory);
  const pathKey = "https://example.com/items/42";
  const history = new SqliteAgentBrowserHistory({ path });
  const firstVisit = history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-delete-metadata",
    url: `${pathKey}?view=summary#top`,
    visitedAt: 1_000,
  });
  history.recordVisit({
    actor: "agent",
    navigationKind: "same-document",
    sessionId: "history-delete-metadata",
    url: `${pathKey}?view=comments#latest`,
    visitedAt: 2_000,
  });
  const latestVisit = history.recordVisit({
    actor: "human",
    navigationKind: "same-document",
    sessionId: "history-delete-metadata",
    url: `${pathKey}?token=deleted-secret#private`,
    visitedAt: 3_000,
  });

  history.deleteVisit(latestVisit);
  assert.deepEqual(readPathStats(path, pathKey), {
    agentVisitCount: 1,
    firstVisitedAt: 1_000,
    humanVisitCount: 1,
    lastUrl: `${pathKey}?view=comments#latest`,
    lastVisitedAt: 2_000,
    visitCount: 2,
  });

  history.deleteVisit(firstVisit);
  assert.deepEqual(readPathStats(path, pathKey), {
    agentVisitCount: 1,
    firstVisitedAt: 2_000,
    humanVisitCount: 0,
    lastUrl: `${pathKey}?view=comments#latest`,
    lastVisitedAt: 2_000,
    visitCount: 1,
  });
  history.close();
});

test("Agent Browser history deletes one visit and updates path aggregates atomically", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-delete-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const history = new SqliteAgentBrowserHistory({
    path: agentBrowserHistoryFilePath(directory),
  });
  const firstVisit = history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-delete",
    url: "https://example.com/items/42?view=summary",
    visitedAt: 1_000,
  });
  const secondVisit = history.recordVisit({
    actor: "agent",
    navigationKind: "same-document",
    sessionId: "history-delete",
    url: "https://example.com/items/42?view=comments",
    visitedAt: 2_000,
  });
  const otherVisit = history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "history-delete",
    url: "https://example.com/other",
    visitedAt: 3_000,
  });
  history.updateVisitFavicon(
    firstVisit,
    "https://example.com/items/42?view=summary",
    "https://example.com/icon.png",
  );

  history.deleteVisit(9_999);
  assert.equal(history.read({ limit: 10 }).totalVisits, 3);

  history.deleteVisit(secondVisit);
  const afterSingleDelete = history.read({ limit: 10 });
  assert.deepEqual(
    {
      agentVisits: afterSingleDelete.agentVisits,
      humanVisits: afterSingleDelete.humanVisits,
      retainedVisits: afterSingleDelete.retainedVisits,
      totalVisits: afterSingleDelete.totalVisits,
      uniquePaths: afterSingleDelete.uniquePaths,
    },
    {
      agentVisits: 1,
      humanVisits: 1,
      retainedVisits: 2,
      totalVisits: 2,
      uniquePaths: 2,
    },
  );
  assert.deepEqual(
    afterSingleDelete.visits.map((visit) => ({
      actor: visit.actor,
      faviconUrl: visit.faviconUrl,
      pathAgentVisits: visit.pathAgentVisits,
      pathHumanVisits: visit.pathHumanVisits,
      pathVisitCount: visit.pathVisitCount,
      visitId: visit.visitId,
    })),
    [
      {
        actor: "agent",
        faviconUrl: "https://example.com/icon.png",
        pathAgentVisits: 1,
        pathHumanVisits: 0,
        pathVisitCount: 1,
        visitId: otherVisit,
      },
      {
        actor: "human",
        faviconUrl: "https://example.com/icon.png",
        pathAgentVisits: 0,
        pathHumanVisits: 1,
        pathVisitCount: 1,
        visitId: firstVisit,
      },
    ],
  );

  history.deleteVisit(firstVisit);
  const afterPathDelete = history.read({ limit: 10 });
  assert.equal(afterPathDelete.uniquePaths, 1);
  assert.equal(
    afterPathDelete.visits[0]?.faviconUrl,
    "https://example.com/icon.png",
  );

  history.deleteVisit(otherVisit);
  history.deleteVisit(otherVisit);
  assert.deepEqual(history.read({ limit: 10 }), {
    agentVisits: 0,
    humanVisits: 0,
    retainedVisits: 0,
    totalVisits: 0,
    uniquePaths: 0,
    visits: [],
  });
  history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-delete",
    url: "https://example.com/fresh",
    visitedAt: 4_000,
  });
  assert.equal(
    history.read({ limit: 1 }).visits[0]?.faviconUrl,
    undefined,
  );
  history.close();
});

test("Agent Browser history retains an origin icon while pruned lifetime history still uses it", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "minke-agent-browser-history-delete-pruned-"),
  );
  t.after(async () => {
    await rm(directory, { force: true, recursive: true });
  });
  const path = agentBrowserHistoryFilePath(directory);
  const pathKey = "https://example.com/items";
  const history = new SqliteAgentBrowserHistory({
    maxRetainedVisits: 1,
    path,
  });
  const firstVisit = history.recordVisit({
    actor: "human",
    navigationKind: "document",
    sessionId: "history-delete-pruned",
    url: `${pathKey}?archived=old`,
    visitedAt: 1_000,
  });
  history.updateVisitFavicon(
    firstVisit,
    `${pathKey}?archived=old`,
    "https://example.com/icon.png",
  );
  const retainedVisit = history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "history-delete-pruned",
    url: `${pathKey}?token=deleted-secret#private`,
    visitedAt: 2_000,
  });

  history.deleteVisit(retainedVisit);
  assert.deepEqual(history.read({ limit: 10 }), {
    agentVisits: 0,
    humanVisits: 1,
    retainedVisits: 0,
    totalVisits: 1,
    uniquePaths: 1,
    visits: [],
  });
  assert.deepEqual(readPathStats(path, pathKey), {
    agentVisitCount: 0,
    firstVisitedAt: 1_000,
    humanVisitCount: 1,
    lastUrl: pathKey,
    lastVisitedAt: 1_000,
    visitCount: 1,
  });
  history.recordVisit({
    actor: "agent",
    navigationKind: "document",
    sessionId: "history-delete-pruned",
    url: "https://example.com/fresh",
    visitedAt: 3_000,
  });
  assert.equal(
    history.read({ limit: 1 }).visits[0]?.faviconUrl,
    "https://example.com/icon.png",
  );
  history.close();
});
