import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GatewayAccountConflictError,
  GatewayCheckpointConflictError,
  GatewayGenerationConflictError,
  GatewayLeaseConflictError,
  GatewayOutboxConflictError,
  type GatewayAccount,
  type GatewayAttemptOutcome,
  type GatewayBatchAdmission,
  type GatewayCipher,
  type GatewayDeliveryAttempt,
  type GatewayDeliveryPreparation,
  type GatewayInboxLease,
  type GatewayInboundBatch,
  type GatewayInboundKind,
  type GatewayOutboxIntent,
  type GatewayOutboxLease,
  type GatewayOutboxSnapshot,
  type GatewayOutboxState,
  type GatewayPreparationOutcome,
  type GatewayRecoveryResult,
  type GatewayUncertainResolution,
} from "@lencx/minke-im-gateway";
import {
  digestGatewayValue,
  openGatewayValue,
  sealGatewayValue,
} from "./value-codec.ts";

interface SqliteGatewayMailboxOptions {
  readonly cipher: GatewayCipher;
  readonly now?: () => number;
  readonly path: string;
}

interface AccountRow {
  readonly account_key: string;
  readonly generation: number;
  readonly provider: string;
  readonly provider_account_id: string;
  readonly requires_delivery_context: number;
}

interface CheckpointRow {
  readonly checkpoint_cipher: Uint8Array | null;
  readonly generation: number;
  readonly revision: number;
}

interface InboxRow {
  readonly account_key: string;
  readonly conversation_id: string;
  readonly generation: number;
  readonly inbox_id: number;
  readonly kind: GatewayInboundKind;
  readonly native_id: string;
  readonly occurred_at: number | null;
  readonly payload_cipher: Uint8Array;
  readonly peer_id: string;
  readonly sender_id: string;
}

interface ContextRow {
  readonly context_cipher: Uint8Array;
  readonly generation: number;
  readonly revision: number;
}

interface OutboxRow {
  readonly account_key: string;
  readonly attempts: number;
  readonly content_cipher: Uint8Array;
  readonly conversation_id: string | null;
  readonly generation: number;
  readonly max_attempts: number;
  readonly operation_id: string;
  readonly outbox_id: number;
  readonly prepared_at: number | null;
  readonly prepared_cipher: Uint8Array | null;
  readonly recipient_id: string;
  readonly requires_context: number;
}

interface OutboxSnapshotRow {
  readonly account_key: string;
  readonly attempts: number;
  readonly generation: number;
  readonly next_attempt_at: number | null;
  readonly operation_id: string;
  readonly outbox_id: number;
  readonly recipient_id: string;
  readonly state: GatewayOutboxState;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation > 0),
    requires_delivery_context INTEGER NOT NULL
      CHECK (requires_delivery_context IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (provider, provider_account_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS checkpoints (
    account_key TEXT PRIMARY KEY REFERENCES accounts(account_key)
      ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    checkpoint_cipher BLOB,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS delivery_contexts (
    account_key TEXT NOT NULL REFERENCES accounts(account_key)
      ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    peer_id TEXT NOT NULL,
    context_cipher BLOB NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    source_event_id TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    PRIMARY KEY (account_key, peer_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS inbox (
    inbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_key TEXT NOT NULL REFERENCES accounts(account_key)
      ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    native_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('bot-echo', 'system', 'user-message')
    ),
    conversation_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    occurred_at INTEGER,
    payload_cipher BLOB NOT NULL,
    state TEXT NOT NULL CHECK (
      state IN ('consumed', 'leased', 'pending')
    ),
    lease_owner TEXT,
    lease_token TEXT,
    lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    admitted_at INTEGER NOT NULL,
    consumed_at INTEGER,
    UNIQUE (account_key, native_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS inbox_claim_idx
    ON inbox(account_key, state, lease_until, inbox_id);

  CREATE TABLE IF NOT EXISTS outbox (
    outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    account_key TEXT NOT NULL REFERENCES accounts(account_key)
      ON DELETE CASCADE,
    generation INTEGER NOT NULL CHECK (generation > 0),
    recipient_id TEXT NOT NULL,
    conversation_id TEXT,
    content_cipher BLOB NOT NULL,
    prepared_cipher BLOB,
    prepared_at INTEGER,
    state TEXT NOT NULL CHECK (
      state IN (
        'accepted',
        'abandoned',
        'attempting',
        'cancelled',
        'confirmed',
        'leased',
        'pending',
        'rejected',
        'retry-wait',
        'uncertain'
      )
    ),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
    next_attempt_at INTEGER,
    lease_owner TEXT,
    lease_token TEXT,
    lease_until INTEGER,
    requires_context INTEGER NOT NULL DEFAULT 0
      CHECK (requires_context IN (0, 1)),
    attempt_token TEXT,
    attempt_started_at INTEGER,
    context_revision INTEGER,
    provider_receipt_id TEXT,
    last_error_code TEXT,
    terminal_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    confirmed_at INTEGER
  ) STRICT;

  CREATE INDEX IF NOT EXISTS outbox_claim_idx
    ON outbox(
      account_key,
      generation,
      state,
      next_attempt_at,
      lease_until,
      outbox_id
    );

  CREATE TABLE IF NOT EXISTS delivery_attempts (
    attempt_token TEXT PRIMARY KEY,
    outbox_id INTEGER NOT NULL REFERENCES outbox(outbox_id)
      ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    generation INTEGER NOT NULL CHECK (generation > 0),
    context_revision INTEGER,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    outcome TEXT,
    error_code TEXT
  ) STRICT;
`;

function count(changes: number | bigint): number {
  return typeof changes === "bigint" ? Number(changes) : changes;
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Gateway database column ${key} is invalid`);
  }
  return value;
}

function nullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value === null) return null;
  return requiredString(row, key);
}

function requiredNumber(
  row: Record<string, unknown>,
  key: string,
): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") {
    throw new Error(`Gateway database column ${key} is invalid`);
  }
  return value;
}

function nullableNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  if (row[key] === null) return null;
  return requiredNumber(row, key);
}

function requiredBytes(
  row: Record<string, unknown>,
  key: string,
): Uint8Array {
  const value = row[key];
  if (!(value instanceof Uint8Array)) {
    throw new Error(`Gateway database column ${key} is invalid`);
  }
  return new Uint8Array(value);
}

function nullableBytes(
  row: Record<string, unknown>,
  key: string,
): Uint8Array | null {
  if (row[key] === null) return null;
  return requiredBytes(row, key);
}

function accountRow(
  row: Record<string, unknown> | undefined,
): AccountRow | undefined {
  if (row === undefined) return undefined;
  return {
    account_key: requiredString(row, "account_key"),
    generation: requiredNumber(row, "generation"),
    provider: requiredString(row, "provider"),
    provider_account_id: requiredString(
      row,
      "provider_account_id",
    ),
    requires_delivery_context: requiredNumber(
      row,
      "requires_delivery_context",
    ),
  };
}

function checkpointRow(
  row: Record<string, unknown> | undefined,
): CheckpointRow | undefined {
  if (row === undefined) return undefined;
  return {
    checkpoint_cipher: nullableBytes(row, "checkpoint_cipher"),
    generation: requiredNumber(row, "generation"),
    revision: requiredNumber(row, "revision"),
  };
}

function inboxRow(
  row: Record<string, unknown> | undefined,
): InboxRow | undefined {
  if (row === undefined) return undefined;
  const kind = requiredString(row, "kind");
  if (
    kind !== "bot-echo" &&
    kind !== "system" &&
    kind !== "user-message"
  ) {
    throw new TypeError("kind is invalid");
  }
  return {
    account_key: requiredString(row, "account_key"),
    conversation_id: requiredString(row, "conversation_id"),
    generation: requiredNumber(row, "generation"),
    inbox_id: requiredNumber(row, "inbox_id"),
    kind,
    native_id: requiredString(row, "native_id"),
    occurred_at: nullableNumber(row, "occurred_at"),
    payload_cipher: requiredBytes(row, "payload_cipher"),
    peer_id: requiredString(row, "peer_id"),
    sender_id: requiredString(row, "sender_id"),
  };
}

function contextRow(
  row: Record<string, unknown> | undefined,
): ContextRow | undefined {
  if (row === undefined) return undefined;
  return {
    context_cipher: requiredBytes(row, "context_cipher"),
    generation: requiredNumber(row, "generation"),
    revision: requiredNumber(row, "revision"),
  };
}

function outboxRow(
  row: Record<string, unknown> | undefined,
): OutboxRow | undefined {
  if (row === undefined) return undefined;
  return {
    account_key: requiredString(row, "account_key"),
    attempts: requiredNumber(row, "attempts"),
    content_cipher: requiredBytes(row, "content_cipher"),
    conversation_id: nullableString(row, "conversation_id"),
    generation: requiredNumber(row, "generation"),
    max_attempts: requiredNumber(row, "max_attempts"),
    operation_id: requiredString(row, "operation_id"),
    outbox_id: requiredNumber(row, "outbox_id"),
    prepared_at: nullableNumber(row, "prepared_at"),
    prepared_cipher: nullableBytes(row, "prepared_cipher"),
    recipient_id: requiredString(row, "recipient_id"),
    requires_context: requiredNumber(row, "requires_context"),
  };
}

function outboxSnapshotRow(
  row: Record<string, unknown> | undefined,
): OutboxSnapshotRow | undefined {
  if (row === undefined) return undefined;
  return {
    account_key: requiredString(row, "account_key"),
    attempts: requiredNumber(row, "attempts"),
    generation: requiredNumber(row, "generation"),
    next_attempt_at: nullableNumber(row, "next_attempt_at"),
    operation_id: requiredString(row, "operation_id"),
    outbox_id: requiredNumber(row, "outbox_id"),
    recipient_id: requiredString(row, "recipient_id"),
    state: requiredString(row, "state") as GatewayOutboxState,
  };
}

function nonempty(value: string, label: string): string {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return value;
}

function generation(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("generation must be a positive safe integer");
  }
  return value;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function purpose(
  area:
    | "checkpoint"
    | "context"
    | "inbox"
    | "outbox"
    | "outbox-prepared",
  accountKey: string,
  immutableGeneration: number,
  rowKey: string,
): string {
  return JSON.stringify([
    "minke-im-gateway",
    1,
    area,
    accountKey,
    immutableGeneration,
    rowKey,
  ]);
}

export class SqliteGatewayMailbox {
  readonly #cipher: GatewayCipher;
  readonly #database: DatabaseSync;
  readonly #now: () => number;
  readonly #path: string;
  #closed = false;

  constructor(options: SqliteGatewayMailboxOptions) {
    if (!isAbsolute(options.path)) {
      throw new TypeError(
        "Gateway SQLite path must be an absolute filesystem path",
      );
    }
    if (
      typeof options.cipher?.open !== "function" ||
      typeof options.cipher.seal !== "function"
    ) {
      throw new TypeError("Gateway cipher must implement seal() and open()");
    }
    this.#cipher = options.cipher;
    this.#now = options.now ?? Date.now;
    this.#path = options.path;
    const directory = dirname(options.path);
    if (!existsSync(directory)) {
      mkdirSync(directory, { mode: 0o700, recursive: true });
    }
    // Close the local-user disclosure window before SQLite creates or opens
    // the database and its journal sidecars.
    chmodSync(directory, 0o700);
    this.#database = new DatabaseSync(options.path, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
    });
    this.#database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA trusted_schema = OFF;
    `);
    const versionRow = this.#database
      .prepare("PRAGMA user_version")
      .get();
    if (versionRow === undefined) {
      this.#database.close();
      throw new Error("Gateway database did not report a schema version");
    }
    const schemaVersion = requiredNumber(
      versionRow,
      "user_version",
    );
    if (schemaVersion > 1) {
      this.#database.close();
      throw new Error(
        `Gateway database schema ${String(schemaVersion)} is not supported by pre-release schema 1; recreate the mailbox`,
      );
    }
    if (schemaVersion === 0) {
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec(SCHEMA);
        this.#database.exec("PRAGMA user_version = 1");
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
          account.requires_delivery_context,
          checkpoint.checkpoint_cipher,
          outbox.prepared_cipher,
          outbox.prepared_at
        FROM accounts AS account
        LEFT JOIN checkpoints AS checkpoint
          ON checkpoint.account_key = account.account_key
        LEFT JOIN outbox
          ON outbox.account_key = account.account_key
        LIMIT 0
      `);
    } catch (error) {
      this.#database.close();
      throw new Error(
        "Gateway database uses an incompatible pre-release schema; recreate the mailbox",
        { cause: error },
      );
    }
    if (typeof this.#database.enableDefensive === "function") {
      this.#database.enableDefensive(true);
    }
    this.#tightenPermissions();
  }

  registerAccount(input: GatewayAccount): void {
    const accountKey = nonempty(input.accountKey, "accountKey");
    const provider = nonempty(input.provider, "provider");
    const providerAccountId = nonempty(
      input.providerAccountId,
      "providerAccountId",
    );
    if (typeof input.requiresDeliveryContext !== "boolean") {
      throw new TypeError(
        "requiresDeliveryContext must be a boolean",
      );
    }
    const nextGeneration = generation(input.generation);
    const now = this.#time();
    this.#transaction(() => {
      const existing = this.#account(accountKey);
      if (existing === undefined) {
        this.#database
          .prepare(`
            INSERT INTO accounts (
              account_key,
              provider,
              provider_account_id,
              generation,
              requires_delivery_context,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            accountKey,
            provider,
            providerAccountId,
            nextGeneration,
            input.requiresDeliveryContext ? 1 : 0,
            now,
            now,
          );
        this.#database
          .prepare(`
            INSERT INTO checkpoints (
              account_key,
              generation,
              checkpoint_cipher,
              revision
            ) VALUES (?, ?, NULL, 0)
          `)
          .run(accountKey, nextGeneration);
        return;
      }
      if (
        existing.provider !== provider ||
        existing.provider_account_id !== providerAccountId ||
        existing.requires_delivery_context !==
          (input.requiresDeliveryContext ? 1 : 0)
      ) {
        throw new GatewayAccountConflictError(
          `account key ${accountKey} is already bound to another provider identity`,
        );
      }
      if (nextGeneration < existing.generation) {
        throw new GatewayGenerationConflictError(
          accountKey,
          nextGeneration,
          existing.generation,
        );
      }
      if (nextGeneration === existing.generation) return;
      this.#database
        .prepare(`
          UPDATE accounts
          SET generation = ?, updated_at = ?
          WHERE account_key = ?
        `)
        .run(nextGeneration, now, accountKey);
      this.#database
        .prepare(`
          UPDATE checkpoints
          SET
            generation = ?,
            checkpoint_cipher = NULL,
            revision = revision + 1
          WHERE account_key = ?
        `)
        .run(nextGeneration, accountKey);
      this.#database
        .prepare(
          "DELETE FROM delivery_contexts WHERE account_key = ?",
        )
        .run(accountKey);
      this.#database
        .prepare(`
          UPDATE inbox
          SET
            state = CASE
              WHEN state = 'leased' THEN 'pending'
              ELSE state
            END,
            lease_owner = NULL,
            lease_token = NULL,
            lease_until = NULL
          WHERE account_key = ? AND state != 'consumed'
        `)
        .run(accountKey);
      this.#database
        .prepare(`
          UPDATE outbox
          SET
            state = CASE
              WHEN state = 'attempting' THEN 'uncertain'
              ELSE 'cancelled'
            END,
            lease_owner = NULL,
            lease_token = NULL,
            lease_until = NULL,
            attempt_token = NULL,
            prepared_cipher = NULL,
            prepared_at = NULL,
            updated_at = ?
          WHERE
            account_key = ?
            AND state IN (
              'attempting',
              'leased',
              'pending',
              'retry-wait'
            )
        `)
        .run(now, accountKey);
    });
  }

  getAccountGeneration(accountKey: string): number | undefined {
    this.#assertOpen();
    return this.#account(
      nonempty(accountKey, "accountKey"),
    )?.generation;
  }

  /**
   * Remove every durable queue owned by one provider.
   *
   * Account foreign keys cascade through checkpoints, inbox, outbox,
   * delivery contexts, and delivery attempts. Other providers in the shared
   * Gateway database remain untouched.
   */
  removeProviderAccounts(provider: string): number {
    const normalizedProvider = nonempty(provider, "provider");
    return this.#transaction(() =>
      count(
        this.#database
          .prepare("DELETE FROM accounts WHERE provider = ?")
          .run(normalizedProvider).changes,
      ),
    );
  }

  admitBatch(input: GatewayInboundBatch): GatewayBatchAdmission {
    const accountKey = nonempty(input.accountKey, "accountKey");
    const expectedGeneration = generation(input.generation);
    if (
      input.fromCheckpoint !== null &&
      typeof input.fromCheckpoint !== "string"
    ) {
      throw new TypeError("fromCheckpoint must be a string or null");
    }
    if (typeof input.nextCheckpoint !== "string") {
      throw new TypeError("nextCheckpoint must be a string");
    }
    const nextCheckpoint = input.nextCheckpoint;
    const observedAt = this.#time(input.observedAt);
    const events = input.events.map((event) => {
      const nativeId = nonempty(event.nativeId, "event.nativeId");
      return {
        ...event,
        conversationId: nonempty(
          event.conversationId,
          "event.conversationId",
        ),
        nativeId,
        payloadCipher: sealGatewayValue(
          this.#cipher,
          purpose(
            "inbox",
            accountKey,
            expectedGeneration,
            nativeId,
          ),
          event.payload,
        ),
        peerId: nonempty(event.peerId, "event.peerId"),
        senderId: nonempty(event.senderId, "event.senderId"),
      };
    });
    return this.#transaction(() => {
      this.#assertGeneration(accountKey, expectedGeneration);
      const checkpoint = checkpointRow(
        this.#database
          .prepare(`
            SELECT generation, checkpoint_cipher, revision
            FROM checkpoints
            WHERE account_key = ?
          `)
          .get(accountKey),
      );
      if (checkpoint === undefined) {
        throw new Error(`Gateway account ${accountKey} has no checkpoint`);
      }
      const actualCheckpoint = this.#checkpointValue(
        accountKey,
        checkpoint,
      );
      if (
        checkpoint.generation !== expectedGeneration ||
        actualCheckpoint !== input.fromCheckpoint
      ) {
        throw new GatewayCheckpointConflictError(
          accountKey,
          input.fromCheckpoint,
          actualCheckpoint,
        );
      }
      const admittedNativeIds: string[] = [];
      const confirmedOperationIds: string[] = [];
      for (const event of events) {
        const eventTime = this.#time(event.occurredAt ?? observedAt);
        const inserted = this.#database
          .prepare(`
            INSERT INTO inbox (
              account_key,
              generation,
              native_id,
              kind,
              conversation_id,
              peer_id,
              sender_id,
              occurred_at,
              payload_cipher,
              state,
              admitted_at,
              consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_key, native_id) DO NOTHING
          `)
          .run(
            accountKey,
            expectedGeneration,
            event.nativeId,
            event.kind,
            event.conversationId,
            event.peerId,
            event.senderId,
            event.occurredAt ?? null,
            event.payloadCipher,
            event.kind === "bot-echo" ? "consumed" : "pending",
            observedAt,
            event.kind === "bot-echo" ? observedAt : null,
          );
        if (
          count(inserted.changes) === 1 &&
          event.kind !== "bot-echo"
        ) {
          admittedNativeIds.push(event.nativeId);
        }
        if (event.deliveryContext !== undefined) {
          const contextCipher = sealGatewayValue(
            this.#cipher,
            purpose(
              "context",
              accountKey,
              expectedGeneration,
              event.peerId,
            ),
            event.deliveryContext,
          );
          this.#database
            .prepare(`
              INSERT INTO delivery_contexts (
                account_key,
                generation,
                peer_id,
                context_cipher,
                revision,
                source_event_id,
                observed_at
              ) VALUES (?, ?, ?, ?, 1, ?, ?)
              ON CONFLICT(account_key, peer_id) DO UPDATE SET
                generation = excluded.generation,
                context_cipher = excluded.context_cipher,
                revision = delivery_contexts.revision + 1,
                source_event_id = excluded.source_event_id,
                observed_at = excluded.observed_at
            `)
            .run(
              accountKey,
              expectedGeneration,
              event.peerId,
              contextCipher,
              event.nativeId,
              eventTime,
            );
        }
        if (
          event.kind === "bot-echo" &&
          event.correlationId !== undefined
        ) {
          const reconciled = this.#database
            .prepare(`
              UPDATE outbox
              SET
                state = 'confirmed',
                confirmed_at = ?,
                updated_at = ?,
                lease_owner = NULL,
                lease_token = NULL,
                lease_until = NULL,
                attempt_token = NULL,
                prepared_cipher = NULL,
                prepared_at = NULL
              WHERE
                account_key = ?
                AND operation_id = ?
                AND state IN (
                  'accepted',
                  'attempting',
                  'leased',
                  'retry-wait',
                  'uncertain'
                )
            `)
            .run(
              observedAt,
              observedAt,
              accountKey,
              event.correlationId,
            );
          if (count(reconciled.changes) === 1) {
            this.#database
              .prepare(`
                UPDATE delivery_attempts
                SET
                  completed_at = ?,
                  outcome = 'confirmed',
                  error_code = NULL
                WHERE
                  completed_at IS NULL
                  AND outbox_id = (
                    SELECT outbox_id
                    FROM outbox
                    WHERE operation_id = ?
                  )
              `)
              .run(observedAt, event.correlationId);
            confirmedOperationIds.push(event.correlationId);
          }
        }
      }
      const advanced = this.#database
        .prepare(`
          UPDATE checkpoints
          SET checkpoint_cipher = ?, revision = revision + 1
          WHERE
            account_key = ?
            AND generation = ?
            AND revision = ?
        `)
        .run(
          sealGatewayValue(
            this.#cipher,
            purpose(
              "checkpoint",
              accountKey,
              expectedGeneration,
              "cursor",
            ),
            nextCheckpoint,
          ),
          accountKey,
          expectedGeneration,
          checkpoint.revision,
        );
      if (count(advanced.changes) !== 1) {
        throw new GatewayCheckpointConflictError(
          accountKey,
          input.fromCheckpoint,
          actualCheckpoint,
        );
      }
      return {
        admittedNativeIds,
        confirmedOperationIds,
        nextCheckpoint,
      };
    });
  }

  getCheckpoint(accountKey: string): string | null {
    this.#assertOpen();
    const normalizedAccountKey = nonempty(
      accountKey,
      "accountKey",
    );
    const row = checkpointRow(
      this.#database
        .prepare(`
          SELECT generation, checkpoint_cipher, revision
          FROM checkpoints
          WHERE account_key = ?
        `)
        .get(normalizedAccountKey),
    );
    if (row === undefined) {
      throw new Error(`Unknown Gateway account ${accountKey}`);
    }
    return this.#checkpointValue(normalizedAccountKey, row);
  }

  getDeliveryContext(
    accountKey: string,
    peerId: string,
  ): string | undefined {
    this.#assertOpen();
    const normalizedAccountKey = nonempty(accountKey, "accountKey");
    const normalizedPeerId = nonempty(peerId, "peerId");
    const row = contextRow(
      this.#database
        .prepare(`
          SELECT context_cipher, generation, revision
          FROM delivery_contexts
          WHERE account_key = ? AND peer_id = ?
        `)
        .get(normalizedAccountKey, normalizedPeerId),
    );
    if (row === undefined) return undefined;
    const value = openGatewayValue(
      this.#cipher,
      purpose(
        "context",
        normalizedAccountKey,
        row.generation,
        normalizedPeerId,
      ),
      row.context_cipher,
    );
    if (typeof value !== "string") {
      throw new Error("Gateway delivery context is invalid");
    }
    return value;
  }

  claimInbox(input: {
    readonly accountKey: string;
    readonly leaseMs: number;
    readonly now?: number;
    readonly workerId: string;
  }): GatewayInboxLease | null {
    const accountKey = nonempty(input.accountKey, "accountKey");
    const workerId = nonempty(input.workerId, "workerId");
    const now = this.#time(input.now);
    const leaseUntil =
      now + positiveDuration(input.leaseMs, "leaseMs");
    return this.#transaction(() => {
      this.#accountRequired(accountKey);
      const row = inboxRow(
        this.#database
          .prepare(`
            SELECT
              inbox_id,
              account_key,
              generation,
              kind,
              native_id,
              conversation_id,
              peer_id,
              sender_id,
              occurred_at,
              payload_cipher
            FROM inbox
            WHERE
              account_key = ?
              AND (
                state = 'pending'
                OR (
                  state = 'leased'
                  AND lease_until <= ?
                )
              )
            ORDER BY inbox_id
            LIMIT 1
          `)
          .get(accountKey, now),
      );
      if (row === undefined) return null;
      const leaseToken = randomUUID();
      const claimed = this.#database
        .prepare(`
          UPDATE inbox
          SET
            state = 'leased',
            lease_owner = ?,
            lease_token = ?,
            lease_until = ?,
            attempts = attempts + 1
          WHERE
            inbox_id = ?
            AND (
              state = 'pending'
              OR (
                state = 'leased'
                AND lease_until <= ?
              )
            )
        `)
        .run(
          workerId,
          leaseToken,
          leaseUntil,
          row.inbox_id,
          now,
        );
      if (count(claimed.changes) !== 1) {
        throw new GatewayLeaseConflictError(
          "Inbox lease changed while it was being claimed",
        );
      }
      return {
        accountKey: row.account_key,
        conversationId: row.conversation_id,
        inboxId: row.inbox_id,
        kind: row.kind,
        leaseToken,
        nativeId: row.native_id,
        occurredAt: row.occurred_at ?? undefined,
        payload: openGatewayValue(
          this.#cipher,
          purpose(
            "inbox",
            row.account_key,
            row.generation,
            row.native_id,
          ),
          row.payload_cipher,
        ),
        peerId: row.peer_id,
        senderId: row.sender_id,
      };
    });
  }

  ackInbox(input: {
    readonly inboxId: number;
    readonly leaseToken: string;
    readonly now?: number;
  }): boolean {
    const now = this.#time(input.now);
    const leaseToken = nonempty(input.leaseToken, "leaseToken");
    if (!Number.isSafeInteger(input.inboxId) || input.inboxId <= 0) {
      throw new TypeError("inboxId must be a positive safe integer");
    }
    return this.#transaction(
      () =>
        count(
          this.#database
            .prepare(`
              UPDATE inbox
              SET
                state = 'consumed',
                consumed_at = ?,
                lease_owner = NULL,
                lease_token = NULL,
                lease_until = NULL
              WHERE
                inbox_id = ?
                AND state = 'leased'
                AND lease_token = ?
                AND lease_until > ?
            `)
            .run(now, input.inboxId, leaseToken, now).changes,
        ) === 1,
    );
  }

  enqueue(input: GatewayOutboxIntent): {
    readonly created: boolean;
    readonly operationId: string;
    readonly outboxId: number;
  } {
    const accountKey = nonempty(input.accountKey, "accountKey");
    const expectedGeneration = generation(input.generation);
    const operationId = nonempty(input.operationId, "operationId");
    const recipientId = nonempty(input.recipientId, "recipientId");
    const maxAttempts = positiveDuration(
      input.maxAttempts ?? 5,
      "maxAttempts",
    );
    const now = this.#time(input.now);
    const digest = digestGatewayValue({
      accountKey,
      conversationId: input.conversationId,
      generation: expectedGeneration,
      maxAttempts,
      operationId,
      payload: input.payload,
      recipientId,
    });
    const contentCipher = sealGatewayValue(
      this.#cipher,
      purpose(
        "outbox",
        accountKey,
        expectedGeneration,
        operationId,
      ),
      input.payload,
    );
    return this.#transaction(() => {
      const account = this.#assertGeneration(
        accountKey,
        expectedGeneration,
      );
      const existing = this.#database
        .prepare(`
          SELECT
            outbox_id,
            account_key,
            generation,
            recipient_id,
            conversation_id,
            content_cipher,
            max_attempts
          FROM outbox
          WHERE operation_id = ?
        `)
        .get(operationId);
      if (existing !== undefined) {
        const existingAccountKey = requiredString(
          existing,
          "account_key",
        );
        const existingGeneration = requiredNumber(
          existing,
          "generation",
        );
        const existingPayload = openGatewayValue(
          this.#cipher,
          purpose(
            "outbox",
            existingAccountKey,
            existingGeneration,
            operationId,
          ),
          requiredBytes(existing, "content_cipher"),
        );
        const existingDigest = digestGatewayValue({
          accountKey: existingAccountKey,
          conversationId:
            nullableString(existing, "conversation_id") ??
            undefined,
          generation: requiredNumber(existing, "generation"),
          maxAttempts: requiredNumber(existing, "max_attempts"),
          operationId,
          payload: existingPayload,
          recipientId: requiredString(existing, "recipient_id"),
        });
        if (
          existingAccountKey !== accountKey ||
          existingDigest !== digest
        ) {
          throw new GatewayOutboxConflictError(operationId);
        }
        return {
          created: false,
          operationId,
          outboxId: requiredNumber(existing, "outbox_id"),
        };
      }
      const inserted = this.#database
        .prepare(`
          INSERT INTO outbox (
            operation_id,
            account_key,
            generation,
            recipient_id,
            conversation_id,
            content_cipher,
            state,
            attempts,
            max_attempts,
            next_attempt_at,
            requires_context,
            created_at,
            updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?
          )
        `)
        .run(
          operationId,
          accountKey,
          expectedGeneration,
          recipientId,
          input.conversationId ?? null,
          contentCipher,
          maxAttempts,
          now,
          account.requires_delivery_context,
          now,
          now,
        );
      return {
        created: true,
        operationId,
        outboxId:
          typeof inserted.lastInsertRowid === "bigint"
            ? Number(inserted.lastInsertRowid)
            : inserted.lastInsertRowid,
      };
    });
  }

  claimOutbox(input: {
    readonly account: GatewayAccount;
    readonly leaseMs: number;
    readonly now?: number;
    readonly workerId: string;
  }): GatewayOutboxLease | null {
    const accountKey = nonempty(
      input.account.accountKey,
      "account.accountKey",
    );
    const provider = nonempty(
      input.account.provider,
      "account.provider",
    );
    const providerAccountId = nonempty(
      input.account.providerAccountId,
      "account.providerAccountId",
    );
    const expectedGeneration = generation(
      input.account.generation,
    );
    if (
      typeof input.account.requiresDeliveryContext !== "boolean"
    ) {
      throw new TypeError(
        "account.requiresDeliveryContext must be a boolean",
      );
    }
    const workerId = nonempty(input.workerId, "workerId");
    const now = this.#time(input.now);
    const leaseUntil =
      now + positiveDuration(input.leaseMs, "leaseMs");
    return this.#transaction(() => {
      const account = this.#accountRequired(accountKey);
      if (
        account.provider !== provider ||
        account.provider_account_id !== providerAccountId ||
        account.requires_delivery_context !==
          (input.account.requiresDeliveryContext ? 1 : 0)
      ) {
        throw new GatewayAccountConflictError(
          `account key ${accountKey} is bound to another provider identity or delivery policy`,
        );
      }
      if (account.generation !== expectedGeneration) {
        throw new GatewayGenerationConflictError(
          accountKey,
          expectedGeneration,
          account.generation,
        );
      }
      const row = outboxRow(
        this.#database
          .prepare(`
            SELECT
              outbox_id,
              operation_id,
              account_key,
              generation,
              recipient_id,
              conversation_id,
              content_cipher,
              prepared_cipher,
              prepared_at,
              attempts,
              max_attempts,
              requires_context
            FROM outbox
            WHERE
              account_key = ?
              AND generation = ?
              AND attempts < max_attempts
              AND (
                state = 'pending'
                OR (
                  state = 'retry-wait'
                  AND next_attempt_at <= ?
                )
                OR (
                  state = 'leased'
                  AND lease_until <= ?
                )
              )
              AND (
                outbox.requires_context = 0
                OR EXISTS (
                  SELECT 1
                  FROM delivery_contexts AS context
                  WHERE
                    context.account_key = outbox.account_key
                    AND context.generation = outbox.generation
                    AND context.peer_id = outbox.recipient_id
                )
              )
            ORDER BY outbox_id
            LIMIT 1
          `)
          .get(
            accountKey,
            expectedGeneration,
            now,
            now,
          ),
      );
      if (row === undefined) return null;
      const leaseToken = randomUUID();
      const claimed = this.#database
        .prepare(`
          UPDATE outbox
          SET
            state = 'leased',
            lease_owner = ?,
            lease_token = ?,
            lease_until = ?,
            updated_at = ?
          WHERE
            outbox_id = ?
            AND (
              state = 'pending'
              OR (
                state = 'retry-wait'
                AND next_attempt_at <= ?
              )
              OR (
                state = 'leased'
                AND lease_until <= ?
              )
            )
        `)
        .run(
          workerId,
          leaseToken,
          leaseUntil,
          now,
          row.outbox_id,
          now,
          now,
        );
      if (count(claimed.changes) !== 1) {
        throw new GatewayLeaseConflictError(
          "Outbox lease changed while it was being claimed",
        );
      }
      return {
        accountKey,
        generation: row.generation,
        leaseToken,
        operationId: row.operation_id,
        outboxId: row.outbox_id,
        requiresDeliveryContext: row.requires_context === 1,
      };
    });
  }

  renewOutboxLease(input: {
    readonly leaseMs: number;
    readonly leaseToken: string;
    readonly now?: number;
    readonly outboxId: number;
  }): boolean {
    const leaseToken = nonempty(input.leaseToken, "leaseToken");
    const now = this.#time(input.now);
    const leaseUntil =
      now + positiveDuration(input.leaseMs, "leaseMs");
    if (!Number.isSafeInteger(input.outboxId) || input.outboxId <= 0) {
      throw new TypeError("outboxId must be a positive safe integer");
    }
    return this.#transaction(
      () =>
        count(
          this.#database
            .prepare(`
              UPDATE outbox
              SET lease_until = ?, updated_at = ?
              WHERE
                outbox_id = ?
                AND state = 'leased'
                AND lease_token = ?
                AND lease_until > ?
            `)
            .run(
              leaseUntil,
              now,
              input.outboxId,
              leaseToken,
              now,
            ).changes,
        ) === 1,
    );
  }

  readPreparation(input: {
    readonly leaseToken: string;
    readonly now?: number;
    readonly outboxId: number;
  }): GatewayDeliveryPreparation {
    const leaseToken = nonempty(input.leaseToken, "leaseToken");
    const now = this.#time(input.now);
    if (!Number.isSafeInteger(input.outboxId) || input.outboxId <= 0) {
      throw new TypeError("outboxId must be a positive safe integer");
    }
    this.#assertOpen();
    const row = outboxRow(
      this.#database
        .prepare(`
          SELECT
            outbox_id,
            operation_id,
            account_key,
            generation,
            recipient_id,
            conversation_id,
            content_cipher,
            prepared_cipher,
            prepared_at,
            attempts,
            max_attempts,
            requires_context
          FROM outbox
          WHERE
            outbox_id = ?
            AND state = 'leased'
            AND lease_token = ?
            AND lease_until > ?
        `)
        .get(input.outboxId, leaseToken, now),
    );
    if (row === undefined) {
      throw new GatewayLeaseConflictError(
        "Outbox lease is stale or no longer preparable",
      );
    }
    this.#assertGeneration(row.account_key, row.generation);
    return {
      accountKey: row.account_key,
      conversationId: row.conversation_id ?? undefined,
      generation: row.generation,
      operationId: row.operation_id,
      outboxId: row.outbox_id,
      payload: openGatewayValue(
        this.#cipher,
        purpose(
          "outbox",
          row.account_key,
          row.generation,
          row.operation_id,
        ),
        row.content_cipher,
      ),
      prepared:
        row.prepared_cipher === null
          ? undefined
          : {
              payload: openGatewayValue(
                this.#cipher,
                purpose(
                  "outbox-prepared",
                  row.account_key,
                  row.generation,
                  row.operation_id,
                ),
                row.prepared_cipher,
              ),
            },
      recipientId: row.recipient_id,
    };
  }

  settlePreparation(input: {
    readonly leaseToken: string;
    readonly now?: number;
    readonly outcome: GatewayPreparationOutcome;
    readonly outboxId: number;
  }): boolean {
    const leaseToken = nonempty(input.leaseToken, "leaseToken");
    const now = this.#time(input.now);
    if (!Number.isSafeInteger(input.outboxId) || input.outboxId <= 0) {
      throw new TypeError("outboxId must be a positive safe integer");
    }
    if (
      input.outcome.status === "retry" &&
      (
        !Number.isSafeInteger(input.outcome.retryAfterMs) ||
        input.outcome.retryAfterMs < 0
      )
    ) {
      throw new TypeError(
        "retryAfterMs must be a non-negative safe integer",
      );
    }
    if (
      input.outcome.status === "deferred" &&
      input.outcome.retryAfterMs !== undefined &&
      (
        !Number.isSafeInteger(input.outcome.retryAfterMs) ||
        input.outcome.retryAfterMs < 0
      )
    ) {
      throw new TypeError(
        "retryAfterMs must be a non-negative safe integer",
      );
    }
    return this.#transaction(() => {
      const row = outboxRow(
        this.#database
          .prepare(`
            SELECT
              outbox_id,
              operation_id,
              account_key,
              generation,
              recipient_id,
              conversation_id,
              content_cipher,
              prepared_cipher,
              prepared_at,
              attempts,
              max_attempts,
              requires_context
            FROM outbox
            WHERE
              outbox_id = ?
              AND state = 'leased'
              AND lease_token = ?
              AND lease_until > ?
          `)
          .get(input.outboxId, leaseToken, now),
      );
      if (row === undefined) return false;
      this.#assertGeneration(row.account_key, row.generation);
      if (input.outcome.status === "ready") {
        const preparedCipher = sealGatewayValue(
          this.#cipher,
          purpose(
            "outbox-prepared",
            row.account_key,
            row.generation,
            row.operation_id,
          ),
          input.outcome.preparedPayload,
        );
        return (
          count(
            this.#database
              .prepare(`
                UPDATE outbox
                SET
                  prepared_cipher = ?,
                  prepared_at = ?,
                  updated_at = ?
                WHERE
                  outbox_id = ?
                  AND state = 'leased'
                  AND lease_token = ?
                  AND lease_until > ?
              `)
              .run(
                preparedCipher,
                now,
                now,
                row.outbox_id,
                leaseToken,
                now,
              ).changes,
          ) === 1
        );
      }
      let state: GatewayOutboxState;
      let nextAttemptAt: number | null = null;
      let errorCode: string;
      let terminalReason: string | null = null;
      switch (input.outcome.status) {
        case "retry":
          state = "retry-wait";
          nextAttemptAt = now + input.outcome.retryAfterMs;
          errorCode = nonempty(
            input.outcome.errorCode,
            "outcome.errorCode",
          );
          break;
        case "deferred": {
          const retryAfterMs = input.outcome.retryAfterMs ?? 0;
          state = retryAfterMs === 0 ? "pending" : "retry-wait";
          nextAttemptAt =
            retryAfterMs === 0 ? now : now + retryAfterMs;
          errorCode = nonempty(
            input.outcome.reasonCode,
            "outcome.reasonCode",
          );
          break;
        }
        case "rejected":
          state = "rejected";
          errorCode = nonempty(
            input.outcome.errorCode,
            "outcome.errorCode",
          );
          terminalReason = input.outcome.terminal ?? null;
          break;
      }
      const clearPrepared = state === "rejected" ? 1 : 0;
      return (
        count(
          this.#database
            .prepare(`
              UPDATE outbox
              SET
                state = ?,
                next_attempt_at = ?,
                lease_owner = NULL,
                lease_token = NULL,
                lease_until = NULL,
                prepared_cipher = CASE
                  WHEN ? = 1 THEN NULL
                  ELSE prepared_cipher
                END,
                prepared_at = CASE
                  WHEN ? = 1 THEN NULL
                  ELSE prepared_at
                END,
                last_error_code = ?,
                terminal_reason = ?,
                updated_at = ?
              WHERE
                outbox_id = ?
                AND state = 'leased'
                AND lease_token = ?
                AND lease_until > ?
            `)
            .run(
              state,
              nextAttemptAt,
              clearPrepared,
              clearPrepared,
              errorCode,
              terminalReason,
              now,
              row.outbox_id,
              leaseToken,
              now,
            ).changes,
        ) === 1
      );
    });
  }

  beginAttempt(input: {
    readonly leaseToken: string;
    readonly now?: number;
    readonly outboxId: number;
  }): GatewayDeliveryAttempt {
    const leaseToken = nonempty(input.leaseToken, "leaseToken");
    const now = this.#time(input.now);
    if (!Number.isSafeInteger(input.outboxId) || input.outboxId <= 0) {
      throw new TypeError("outboxId must be a positive safe integer");
    }
    return this.#transaction(() => {
      const row = outboxRow(
        this.#database
          .prepare(`
            SELECT
              outbox_id,
              operation_id,
              account_key,
              generation,
              recipient_id,
              conversation_id,
              content_cipher,
              prepared_cipher,
              prepared_at,
              attempts,
              max_attempts,
              requires_context
            FROM outbox
            WHERE
              outbox_id = ?
              AND state = 'leased'
              AND lease_token = ?
              AND lease_until > ?
              AND prepared_cipher IS NOT NULL
          `)
          .get(input.outboxId, leaseToken, now),
      );
      if (row === undefined) {
        throw new GatewayLeaseConflictError(
          "Outbox lease is stale or no longer dispatchable",
        );
      }
      this.#assertGeneration(row.account_key, row.generation);
      const context = contextRow(
        this.#database
          .prepare(`
            SELECT context_cipher, generation, revision
            FROM delivery_contexts
            WHERE
              account_key = ?
              AND generation = ?
              AND peer_id = ?
          `)
          .get(
            row.account_key,
            row.generation,
            row.recipient_id,
          ),
      );
      if (row.requires_context === 1 && context === undefined) {
        throw new GatewayLeaseConflictError(
          "Required delivery context disappeared before dispatch",
        );
      }
      const attemptToken = randomUUID();
      const attemptNumber = row.attempts + 1;
      const started = this.#database
        .prepare(`
          UPDATE outbox
          SET
            state = 'attempting',
            attempts = ?,
            attempt_token = ?,
            attempt_started_at = ?,
            context_revision = ?,
            updated_at = ?
          WHERE
            outbox_id = ?
            AND state = 'leased'
            AND lease_token = ?
            AND lease_until > ?
        `)
        .run(
          attemptNumber,
          attemptToken,
          now,
          context?.revision ?? null,
          now,
          row.outbox_id,
          leaseToken,
          now,
        );
      if (count(started.changes) !== 1) {
        throw new GatewayLeaseConflictError(
          "Outbox lease changed before dispatch began",
        );
      }
      this.#database
        .prepare(`
          INSERT INTO delivery_attempts (
            attempt_token,
            outbox_id,
            attempt_number,
            generation,
            context_revision,
            started_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          attemptToken,
          row.outbox_id,
          attemptNumber,
          row.generation,
          context?.revision ?? null,
          now,
        );
      let deliveryContext: string | undefined;
      if (context !== undefined) {
        const value = openGatewayValue(
          this.#cipher,
          purpose(
            "context",
            row.account_key,
            context.generation,
            row.recipient_id,
          ),
          context.context_cipher,
        );
        if (typeof value !== "string") {
          throw new Error("Gateway delivery context is invalid");
        }
        deliveryContext = value;
      }
      return {
        accountKey: row.account_key,
        attemptNumber,
        attemptToken,
        conversationId: row.conversation_id ?? undefined,
        deliveryContext,
        deliveryContextRevision: context?.revision,
        operationId: row.operation_id,
        outboxId: row.outbox_id,
        preparedPayload: openGatewayValue(
          this.#cipher,
          purpose(
            "outbox-prepared",
            row.account_key,
            row.generation,
            row.operation_id,
          ),
          row.prepared_cipher!,
        ),
        recipientId: row.recipient_id,
      };
    });
  }

  settleAttempt(input: {
    readonly attemptToken: string;
    readonly now?: number;
    readonly outcome: GatewayAttemptOutcome;
    readonly outboxId: number;
  }): boolean {
    const attemptToken = nonempty(
      input.attemptToken,
      "attemptToken",
    );
    const now = this.#time(input.now);
    if (!Number.isSafeInteger(input.outboxId) || input.outboxId <= 0) {
      throw new TypeError("outboxId must be a positive safe integer");
    }
    if (
      input.outcome.status === "retry" &&
      (
        !Number.isSafeInteger(input.outcome.retryAfterMs) ||
        input.outcome.retryAfterMs < 0
      )
    ) {
      throw new TypeError(
        "retryAfterMs must be a non-negative safe integer",
      );
    }
    if (
      input.outcome.status === "deferred" &&
      input.outcome.retryAfterMs !== undefined &&
      (
        !Number.isSafeInteger(input.outcome.retryAfterMs) ||
        input.outcome.retryAfterMs < 0
      )
    ) {
      throw new TypeError(
        "retryAfterMs must be a non-negative safe integer",
      );
    }
    return this.#transaction(() => {
      const row = outboxRow(
        this.#database
          .prepare(`
            SELECT
              outbox_id,
              operation_id,
              account_key,
              generation,
              recipient_id,
              conversation_id,
              content_cipher,
              prepared_cipher,
              prepared_at,
              attempts,
              max_attempts,
              requires_context
            FROM outbox
            WHERE
              outbox_id = ?
              AND state = 'attempting'
              AND attempt_token = ?
          `)
          .get(input.outboxId, attemptToken),
      );
      if (row === undefined) return false;
      let state: GatewayOutboxState;
      let nextAttemptAt: number | null = null;
      let errorCode: string | null = null;
      let providerReceiptId: string | null = null;
      let terminalReason: string | null = null;
      let attempts = row.attempts;
      let attemptOutcome: string;
      switch (input.outcome.status) {
        case "accepted":
          state = "accepted";
          attemptOutcome = state;
          providerReceiptId =
            input.outcome.providerReceiptId ?? null;
          break;
        case "retry":
          errorCode = nonempty(
            input.outcome.errorCode,
            "outcome.errorCode",
          );
          if (row.attempts >= row.max_attempts) {
            state = "abandoned";
          } else {
            state = "retry-wait";
            nextAttemptAt = now + input.outcome.retryAfterMs;
          }
          attemptOutcome = state;
          break;
        case "uncertain":
          state = "uncertain";
          attemptOutcome = state;
          errorCode = nonempty(
            input.outcome.errorCode,
            "outcome.errorCode",
          );
          break;
        case "rejected":
          state = "rejected";
          attemptOutcome = state;
          errorCode = nonempty(
            input.outcome.errorCode,
            "outcome.errorCode",
          );
          terminalReason = input.outcome.terminal ?? null;
          break;
        case "deferred": {
          const retryAfterMs = input.outcome.retryAfterMs ?? 0;
          state = retryAfterMs === 0 ? "pending" : "retry-wait";
          nextAttemptAt =
            retryAfterMs === 0 ? now : now + retryAfterMs;
          attempts = Math.max(0, row.attempts - 1);
          errorCode = nonempty(
            input.outcome.reasonCode,
            "outcome.reasonCode",
          );
          attemptOutcome = "deferred";
          break;
          }
      }
      const clearPrepared =
        state === "accepted" ||
        state === "abandoned" ||
        state === "rejected"
          ? 1
          : 0;
      const settled = this.#database
        .prepare(`
          UPDATE outbox
          SET
            state = ?,
            attempts = ?,
            next_attempt_at = ?,
            lease_owner = NULL,
            lease_token = NULL,
            lease_until = NULL,
            attempt_token = NULL,
            prepared_cipher = CASE
              WHEN ? = 1 THEN NULL
              ELSE prepared_cipher
            END,
            prepared_at = CASE
              WHEN ? = 1 THEN NULL
              ELSE prepared_at
            END,
            provider_receipt_id = ?,
            last_error_code = ?,
            terminal_reason = ?,
            updated_at = ?
          WHERE
            outbox_id = ?
            AND state = 'attempting'
            AND attempt_token = ?
        `)
        .run(
          state,
          attempts,
          nextAttemptAt,
          clearPrepared,
          clearPrepared,
          providerReceiptId,
          errorCode,
          terminalReason,
          now,
          row.outbox_id,
          attemptToken,
        );
      if (count(settled.changes) !== 1) return false;
      this.#database
        .prepare(`
          UPDATE delivery_attempts
          SET completed_at = ?, outcome = ?, error_code = ?
          WHERE attempt_token = ?
        `)
        .run(now, attemptOutcome, errorCode, attemptToken);
      return true;
    });
  }

  recover(input: { readonly now?: number } = {}): GatewayRecoveryResult {
    const now = this.#time(input.now);
    return this.#transaction(() => {
      const inboxLeasesReleased = count(
        this.#database
          .prepare(`
            UPDATE inbox
            SET
              state = 'pending',
              lease_owner = NULL,
              lease_token = NULL,
              lease_until = NULL
            WHERE state = 'leased'
          `)
          .run().changes,
      );
      const outboxLeasesReleased = count(
        this.#database
          .prepare(`
            UPDATE outbox
            SET
              state = 'pending',
              lease_owner = NULL,
              lease_token = NULL,
              lease_until = NULL,
              updated_at = ?
            WHERE state = 'leased'
          `)
          .run(now).changes,
      );
      const outboxMarkedUncertain = count(
        this.#database
          .prepare(`
            UPDATE outbox
            SET
              state = 'uncertain',
              lease_owner = NULL,
              lease_token = NULL,
              lease_until = NULL,
              attempt_token = NULL,
              last_error_code = 'process-restarted',
              updated_at = ?
            WHERE state = 'attempting'
          `)
          .run(now).changes,
      );
      this.#database
        .prepare(`
          UPDATE delivery_attempts
          SET
            completed_at = ?,
            outcome = 'uncertain',
            error_code = 'process-restarted'
          WHERE completed_at IS NULL
        `)
        .run(now);
      return {
        inboxLeasesReleased,
        outboxLeasesReleased,
        outboxMarkedUncertain,
      };
    });
  }

  inspectOutbox(operationId: string): GatewayOutboxSnapshot {
    this.#assertOpen();
    const normalizedOperationId = nonempty(
      operationId,
      "operationId",
    );
    const row = outboxSnapshotRow(
      this.#database
        .prepare(`
          SELECT
            outbox_id,
            operation_id,
            account_key,
            generation,
            recipient_id,
            state,
            attempts,
            next_attempt_at
          FROM outbox
          WHERE operation_id = ?
        `)
        .get(normalizedOperationId),
    );
    if (row === undefined) {
      throw new Error(`Unknown Gateway operation ${operationId}`);
    }
    return {
      accountKey: row.account_key,
      attempts: row.attempts,
      generation: row.generation,
      nextAttemptAt: row.next_attempt_at ?? undefined,
      operationId: row.operation_id,
      outboxId: row.outbox_id,
      recipientId: row.recipient_id,
      state: row.state,
    };
  }

  listUncertain(
    input: {
      readonly accountKey?: string;
      readonly limit?: number;
    } = {},
  ): readonly GatewayOutboxSnapshot[] {
    this.#assertOpen();
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new TypeError(
        "uncertain outbox limit must be between 1 and 1000",
      );
    }
    const rows =
      input.accountKey === undefined
        ? this.#database
            .prepare(`
              SELECT
                outbox_id,
                operation_id,
                account_key,
                generation,
                recipient_id,
                state,
                attempts,
                next_attempt_at
              FROM outbox
              WHERE state = 'uncertain'
              ORDER BY outbox_id
              LIMIT ?
            `)
            .all(limit)
        : this.#database
            .prepare(`
              SELECT
                outbox_id,
                operation_id,
                account_key,
                generation,
                recipient_id,
                state,
                attempts,
                next_attempt_at
              FROM outbox
              WHERE state = 'uncertain' AND account_key = ?
              ORDER BY outbox_id
              LIMIT ?
            `)
            .all(
              nonempty(input.accountKey, "accountKey"),
              limit,
            );
    return rows.map((value) => {
      const row = outboxSnapshotRow(value);
      if (row === undefined) {
        throw new Error("Gateway uncertain outbox row is invalid");
      }
      return {
        accountKey: row.account_key,
        attempts: row.attempts,
        generation: row.generation,
        nextAttemptAt: row.next_attempt_at ?? undefined,
        operationId: row.operation_id,
        outboxId: row.outbox_id,
        recipientId: row.recipient_id,
        state: row.state,
      };
    });
  }

  resolveUncertain(input: {
    readonly now?: number;
    readonly operationId: string;
    readonly resolution: GatewayUncertainResolution;
    readonly retryAfterMs?: number;
  }): boolean {
    const operationId = nonempty(input.operationId, "operationId");
    const now = this.#time(input.now);
    const retryAfterMs = input.retryAfterMs ?? 0;
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) {
      throw new TypeError(
        "retryAfterMs must be a non-negative safe integer",
      );
    }
    if (
      input.resolution !== "abandon" &&
      input.resolution !== "confirm" &&
      input.resolution !== "retry-with-warning"
    ) {
      throw new TypeError("Unknown uncertain outbox resolution");
    }
    return this.#transaction(() => {
      const current = this.#database
        .prepare(`
          SELECT
            outbox.account_key,
            outbox.attempts,
            outbox.generation,
            outbox.max_attempts,
            account.generation AS current_generation
          FROM outbox
          JOIN accounts AS account
            ON account.account_key = outbox.account_key
          WHERE
            outbox.operation_id = ?
            AND outbox.state = 'uncertain'
        `)
        .get(operationId);
      if (current === undefined) return false;
      if (
        input.resolution === "retry-with-warning" &&
        requiredNumber(current, "generation") !==
          requiredNumber(current, "current_generation")
      ) {
        throw new GatewayGenerationConflictError(
          requiredString(current, "account_key"),
          requiredNumber(current, "generation"),
          requiredNumber(current, "current_generation"),
        );
      }
      let state: GatewayOutboxState;
      let nextAttemptAt: number | null = null;
      let confirmedAt: number | null = null;
      switch (input.resolution) {
        case "abandon":
          state = "abandoned";
          break;
        case "confirm":
          state = "confirmed";
          confirmedAt = now;
          break;
        case "retry-with-warning":
          if (
            requiredNumber(current, "attempts") >=
            requiredNumber(current, "max_attempts")
          ) {
            state = "abandoned";
          } else {
            state = "retry-wait";
            nextAttemptAt = now + retryAfterMs;
          }
          break;
      }
      const clearPrepared = state === "retry-wait" ? 0 : 1;
      return (
        count(
          this.#database
            .prepare(`
              UPDATE outbox
              SET
                state = ?,
                next_attempt_at = ?,
                confirmed_at = ?,
                prepared_cipher = CASE
                  WHEN ? = 1 THEN NULL
                  ELSE prepared_cipher
                END,
                prepared_at = CASE
                  WHEN ? = 1 THEN NULL
                  ELSE prepared_at
                END,
                last_error_code = ?,
                updated_at = ?
              WHERE operation_id = ? AND state = 'uncertain'
            `)
            .run(
              state,
              nextAttemptAt,
              confirmedAt,
              clearPrepared,
              clearPrepared,
              input.resolution === "retry-with-warning"
                ? "manual-retry-approved"
                : null,
              now,
              operationId,
            ).changes,
        ) === 1
      );
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
    this.#tightenPermissions();
  }

  #account(accountKey: string): AccountRow | undefined {
    return accountRow(
      this.#database
        .prepare(`
          SELECT
            account_key,
            provider,
            provider_account_id,
            generation,
            requires_delivery_context
          FROM accounts
          WHERE account_key = ?
        `)
        .get(accountKey),
    );
  }

  #accountRequired(accountKey: string): AccountRow {
    const row = this.#account(accountKey);
    if (row === undefined) {
      throw new Error(`Unknown Gateway account ${accountKey}`);
    }
    return row;
  }

  #assertGeneration(
    accountKey: string,
    expectedGeneration: number,
  ): AccountRow {
    const row = this.#accountRequired(accountKey);
    if (row.generation !== expectedGeneration) {
      throw new GatewayGenerationConflictError(
        accountKey,
        expectedGeneration,
        row.generation,
      );
    }
    return row;
  }

  #checkpointValue(
    accountKey: string,
    row: CheckpointRow,
  ): string | null {
    if (row.checkpoint_cipher === null) return null;
    const value = openGatewayValue(
      this.#cipher,
      purpose(
        "checkpoint",
        accountKey,
        row.generation,
        "cursor",
      ),
      row.checkpoint_cipher,
    );
    if (typeof value !== "string") {
      throw new Error("Gateway checkpoint is invalid");
    }
    return value;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("Gateway mailbox is closed");
    }
  }

  #tightenPermissions(): void {
    for (const path of [
      this.#path,
      `${this.#path}-shm`,
      `${this.#path}-wal`,
    ]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }

  #time(value?: number): number {
    return timestamp(value ?? this.#now(), "timestamp");
  }

  #transaction<Result>(callback: () => Result): Result {
    this.#assertOpen();
    this.#tightenPermissions();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the operation error; a failed rollback leaves this
        // connection unusable and the next call will fail closed.
      }
      throw error;
    }
  }
}

export function createSqliteGatewayMailbox(
  options: SqliteGatewayMailboxOptions,
): SqliteGatewayMailbox {
  return new SqliteGatewayMailbox(options);
}
