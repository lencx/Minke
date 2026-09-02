import {
  chmodSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  normalizeAgentBrowserUrl,
  parseAgentBrowserSessionId,
  type AgentBrowserOwner,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  parseAgentBrowserHistoryReadRequest,
  parseAgentBrowserHistorySnapshot,
  type AgentBrowserHistoryReadRequest,
  type AgentBrowserHistorySnapshot,
  type AgentBrowserNavigationKind,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_RETAINED_VISITS = 100_000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS visits (
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

  CREATE INDEX IF NOT EXISTS visits_time_idx
    ON visits(visited_at DESC, visit_id DESC);

  CREATE INDEX IF NOT EXISTS visits_actor_time_idx
    ON visits(actor, visited_at DESC, visit_id DESC);

  CREATE INDEX IF NOT EXISTS visits_path_time_idx
    ON visits(path_key, visited_at DESC, visit_id DESC);

  CREATE TABLE IF NOT EXISTS path_stats (
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

  CREATE INDEX IF NOT EXISTS path_stats_last_visit_idx
    ON path_stats(last_visited_at DESC, path_key);
`;

export interface AgentBrowserVisitRecord {
  readonly sessionId: string;
  readonly url: string;
  readonly actor: AgentBrowserOwner;
  readonly navigationKind: AgentBrowserNavigationKind;
  readonly visitedAt: number;
}

export interface AgentBrowserHistoryPort {
  recordVisit(visit: AgentBrowserVisitRecord): void;
  read(
    request: AgentBrowserHistoryReadRequest,
  ): AgentBrowserHistorySnapshot;
  clear(): void;
  close(): void;
}

export interface SqliteAgentBrowserHistoryOptions {
  readonly path: string;
  readonly maxRetainedVisits?: number;
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  const parsed =
    typeof value === "bigint" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum
  ) {
    throw new TypeError(`${label} must be a bounded integer`);
  }
  return parsed;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function actor(value: unknown): AgentBrowserOwner {
  if (value !== "agent" && value !== "human") {
    throw new TypeError("invalid Agent Browser history actor");
  }
  return value;
}

function navigationKind(
  value: unknown,
): AgentBrowserNavigationKind {
  if (value !== "document" && value !== "same-document") {
    throw new TypeError(
      "invalid Agent Browser history navigation kind",
    );
  }
  return value;
}

function row(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Agent Browser history row is invalid");
  }
  return value as Record<string, unknown>;
}

function maxRetainedVisits(value: unknown): number {
  return integer(
    value ?? DEFAULT_MAX_RETAINED_VISITS,
    "Agent Browser retained visit limit",
    1,
  );
}

/** Resolve the private browsing-footprint database below Minke user data. */
export function agentBrowserHistoryFilePath(
  userDataPath: string,
): string {
  if (!isAbsolute(userDataPath)) {
    throw new TypeError(
      "Agent Browser user-data path must be absolute",
    );
  }
  return join(
    userDataPath,
    "agent-browser",
    "history.sqlite",
  );
}

/**
 * Durable local browsing-footprint module.
 *
 * `visits` retains the recent event timeline while `path_stats` preserves
 * lifetime per-path counts. Query strings and fragments remain in the exact
 * local URL, but path aggregation deliberately ignores both.
 */
export class SqliteAgentBrowserHistory
  implements AgentBrowserHistoryPort {
  readonly #database: DatabaseSync;
  readonly #maxRetainedVisits: number;
  #closed = false;

  constructor(options: SqliteAgentBrowserHistoryOptions) {
    if (!isAbsolute(options.path)) {
      throw new TypeError(
        "Agent Browser SQLite path must be absolute",
      );
    }
    this.#maxRetainedVisits =
      maxRetainedVisits(options.maxRetainedVisits);
    const directory = dirname(options.path);
    if (!existsSync(directory)) {
      mkdirSync(directory, { mode: 0o700, recursive: true });
    }
    chmodSync(directory, 0o700);
    this.#database = new DatabaseSync(options.path, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    chmodSync(options.path, 0o600);
    this.#database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA trusted_schema = OFF;
    `);
    const version = row(
      this.#database.prepare("PRAGMA user_version").get(),
    );
    const schemaVersion = integer(
      version.user_version,
      "Agent Browser history schema version",
    );
    if (schemaVersion > SCHEMA_VERSION) {
      this.#database.close();
      throw new Error(
        `Agent Browser history schema ${String(schemaVersion)} is newer than supported schema ${String(SCHEMA_VERSION)}`,
      );
    }
    if (schemaVersion === 0) {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec(SCHEMA);
        this.#database.exec(
          `PRAGMA user_version = ${String(SCHEMA_VERSION)}`,
        );
        this.#database.exec("COMMIT");
      } catch (error) {
        try {
          this.#database.exec("ROLLBACK");
        } finally {
          this.#database.close();
        }
        throw error;
      }
    }
    try {
      this.#database.prepare(`
        SELECT
          visit.visit_id,
          path.visit_count
        FROM visits AS visit
        INNER JOIN path_stats AS path
          ON path.path_key = visit.path_key
        LIMIT 0
      `);
    } catch (error) {
      this.#database.close();
      throw new Error(
        "Agent Browser history database uses an incompatible schema",
        { cause: error },
      );
    }
    if (typeof this.#database.enableDefensive === "function") {
      this.#database.enableDefensive(true);
    }
  }

  recordVisit(value: AgentBrowserVisitRecord): void {
    this.#ensureOpen();
    const sessionId = parseAgentBrowserSessionId(value.sessionId);
    const url = normalizeAgentBrowserUrl(value.url);
    const parsedUrl = new URL(url);
    const visitActor = actor(value.actor);
    const kind = navigationKind(value.navigationKind);
    const visitedAt = integer(
      value.visitedAt,
      "Agent Browser visit timestamp",
    );
    const origin = parsedUrl.origin;
    const pathname = parsedUrl.pathname;
    const pathKey = `${origin}${pathname}`;
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare(`
        INSERT INTO visits (
          session_id,
          url,
          origin,
          pathname,
          path_key,
          actor,
          navigation_kind,
          visited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        url,
        origin,
        pathname,
        pathKey,
        visitActor,
        kind,
        visitedAt,
      );
      this.#database.prepare(`
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
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(path_key) DO UPDATE SET
          visit_count = path_stats.visit_count + 1,
          agent_visit_count = path_stats.agent_visit_count
            + excluded.agent_visit_count,
          human_visit_count = path_stats.human_visit_count
            + excluded.human_visit_count,
          first_visited_at = MIN(
            path_stats.first_visited_at,
            excluded.first_visited_at
          ),
          last_visited_at = MAX(
            path_stats.last_visited_at,
            excluded.last_visited_at
          ),
          last_url = CASE
            WHEN excluded.last_visited_at >= path_stats.last_visited_at
              THEN excluded.last_url
            ELSE path_stats.last_url
          END
      `).run(
        pathKey,
        origin,
        pathname,
        visitActor === "agent" ? 1 : 0,
        visitActor === "human" ? 1 : 0,
        visitedAt,
        visitedAt,
        url,
      );
      this.#database.prepare(`
        DELETE FROM visits
        WHERE visit_id IN (
          SELECT visit_id
          FROM visits
          ORDER BY visited_at DESC, visit_id DESC
          LIMIT -1 OFFSET ?
        )
      `).run(this.#maxRetainedVisits);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  read(
    value: AgentBrowserHistoryReadRequest,
  ): AgentBrowserHistorySnapshot {
    this.#ensureOpen();
    const request = parseAgentBrowserHistoryReadRequest(value);
    const summary = row(this.#database.prepare(`
      SELECT
        COALESCE(SUM(visit_count), 0) AS total_visits,
        COALESCE(SUM(agent_visit_count), 0) AS agent_visits,
        COALESCE(SUM(human_visit_count), 0) AS human_visits,
        COUNT(*) AS unique_paths
      FROM path_stats
    `).get());
    const retained = row(this.#database.prepare(`
      SELECT COUNT(*) AS retained_visits
      FROM visits
    `).get());
    const rows = this.#database.prepare(`
      SELECT
        visit.visit_id,
        visit.visited_at,
        visit.actor,
        visit.navigation_kind,
        visit.url,
        visit.origin,
        visit.pathname,
        visit.path_key,
        path.visit_count,
        path.agent_visit_count,
        path.human_visit_count
      FROM visits AS visit
      INNER JOIN path_stats AS path
        ON path.path_key = visit.path_key
      WHERE (? IS NULL OR visit.actor = ?)
      ORDER BY visit.visited_at DESC, visit.visit_id DESC
      LIMIT ?
    `).all(
      request.actor ?? null,
      request.actor ?? null,
      request.limit,
    ).map(row);
    return parseAgentBrowserHistorySnapshot({
      totalVisits: integer(
        summary.total_visits,
        "Agent Browser total visits",
      ),
      retainedVisits: integer(
        retained.retained_visits,
        "Agent Browser retained visits",
      ),
      uniquePaths: integer(
        summary.unique_paths,
        "Agent Browser unique paths",
      ),
      agentVisits: integer(
        summary.agent_visits,
        "Agent Browser agent visits",
      ),
      humanVisits: integer(
        summary.human_visits,
        "Agent Browser human visits",
      ),
      visits: rows.map((visit) => ({
        visitId: integer(
          visit.visit_id,
          "Agent Browser visit id",
          1,
        ),
        visitedAt: integer(
          visit.visited_at,
          "Agent Browser visit timestamp",
        ),
        actor: actor(visit.actor),
        navigationKind: navigationKind(
          visit.navigation_kind,
        ),
        url: string(visit.url, "Agent Browser visit URL"),
        origin: string(
          visit.origin,
          "Agent Browser visit origin",
        ),
        pathname: string(
          visit.pathname,
          "Agent Browser visit pathname",
        ),
        pathKey: string(
          visit.path_key,
          "Agent Browser visit path key",
        ),
        pathVisitCount: integer(
          visit.visit_count,
          "Agent Browser path visit count",
          1,
        ),
        pathAgentVisits: integer(
          visit.agent_visit_count,
          "Agent Browser path agent visits",
        ),
        pathHumanVisits: integer(
          visit.human_visit_count,
          "Agent Browser path human visits",
        ),
      })),
    });
  }

  clear(): void {
    this.#ensureOpen();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.exec(`
        DELETE FROM visits;
        DELETE FROM path_stats;
        DELETE FROM sqlite_sequence WHERE name = 'visits';
      `);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    this.#database.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      VACUUM;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#database.exec("PRAGMA optimize");
    } finally {
      this.#database.close();
    }
  }

  #ensureOpen(): void {
    if (this.#closed) {
      throw new Error("Agent Browser history is closed");
    }
  }
}
