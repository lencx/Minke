export interface GatewayCipher {
  open(ciphertext: Uint8Array, purpose: string): Uint8Array;
  seal(plaintext: Uint8Array, purpose: string): Uint8Array;
}

export interface GatewayAccount {
  readonly accountKey: string;
  readonly generation: number;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly requiresDeliveryContext: boolean;
}

export type GatewayInboundKind =
  | "bot-echo"
  | "system"
  | "user-message";

export interface GatewayInboundEvent {
  readonly conversationId: string;
  readonly correlationId?: string;
  readonly deliveryContext?: string;
  readonly kind: GatewayInboundKind;
  readonly nativeId: string;
  readonly occurredAt?: number;
  readonly payload: unknown;
  readonly peerId: string;
  readonly senderId: string;
}

export interface GatewayInboundBatch {
  readonly accountKey: string;
  readonly events: readonly GatewayInboundEvent[];
  readonly fromCheckpoint: string | null;
  readonly generation: number;
  readonly nextCheckpoint: string;
  readonly observedAt?: number;
}

export interface GatewayBatchAdmission {
  readonly admittedNativeIds: readonly string[];
  readonly confirmedOperationIds: readonly string[];
  readonly nextCheckpoint: string;
}

export interface GatewayInboxLease {
  readonly accountKey: string;
  readonly conversationId: string;
  readonly inboxId: number;
  readonly kind: GatewayInboundKind;
  readonly leaseToken: string;
  readonly nativeId: string;
  readonly occurredAt?: number;
  readonly payload: unknown;
  readonly peerId: string;
  readonly senderId: string;
}

export interface GatewayOutboxIntent {
  readonly accountKey: string;
  readonly conversationId?: string;
  readonly generation: number;
  readonly maxAttempts?: number;
  readonly now?: number;
  readonly operationId: string;
  readonly payload: unknown;
  readonly recipientId: string;
}

export type GatewayOutboxState =
  | "accepted"
  | "abandoned"
  | "cancelled"
  | "confirmed"
  | "leased"
  | "pending"
  | "rejected"
  | "retry-wait"
  | "uncertain"
  | "attempting";

export interface GatewayOutboxLease {
  readonly accountKey: string;
  readonly generation: number;
  readonly leaseToken: string;
  readonly operationId: string;
  readonly outboxId: number;
  readonly requiresDeliveryContext: boolean;
}

export interface GatewayDeliveryPreparation {
  readonly accountKey: string;
  readonly conversationId?: string;
  readonly generation: number;
  readonly operationId: string;
  readonly outboxId: number;
  readonly payload: unknown;
  readonly prepared?: {
    readonly payload: unknown;
  };
  readonly recipientId: string;
}

export interface GatewayDeliveryAttempt {
  readonly accountKey: string;
  readonly attemptNumber: number;
  readonly attemptToken: string;
  readonly conversationId?: string;
  readonly deliveryContext?: string;
  readonly deliveryContextRevision?: number;
  readonly operationId: string;
  readonly outboxId: number;
  readonly preparedPayload: unknown;
  readonly recipientId: string;
}

export type GatewayPreparationOutcome =
  | {
      readonly preparedPayload: unknown;
      readonly status: "ready";
    }
  | {
      readonly errorCode: string;
      readonly retryAfterMs: number;
      readonly status: "retry";
    }
  | {
      readonly errorCode: string;
      readonly terminal?: "credential-invalid" | "session-stale";
      readonly status: "rejected";
    }
  | {
      readonly reasonCode: string;
      readonly retryAfterMs?: number;
      readonly status: "deferred";
    };

export type GatewayAttemptOutcome =
  | {
      readonly providerReceiptId?: string;
      readonly status: "accepted";
    }
  | {
      readonly errorCode: string;
      readonly retryAfterMs: number;
      readonly status: "retry";
    }
  | {
      readonly errorCode: string;
      readonly status: "uncertain";
    }
  | {
      readonly errorCode: string;
      readonly terminal?: "credential-invalid" | "session-stale";
      readonly status: "rejected";
    }
  | {
      readonly reasonCode: string;
      readonly retryAfterMs?: number;
      readonly status: "deferred";
    };

export interface GatewayOutboxSnapshot {
  readonly accountKey: string;
  readonly attempts: number;
  readonly generation: number;
  readonly nextAttemptAt?: number;
  readonly operationId: string;
  readonly outboxId: number;
  readonly recipientId: string;
  readonly state: GatewayOutboxState;
}

export interface GatewayRecoveryResult {
  readonly inboxLeasesReleased: number;
  readonly outboxLeasesReleased: number;
  readonly outboxMarkedUncertain: number;
}

export type GatewayUncertainResolution =
  | "abandon"
  | "confirm"
  | "retry-with-warning";

export class GatewayAccountConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayAccountConflictError";
  }
}

export class GatewayCheckpointConflictError extends Error {
  readonly accountKey: string;
  readonly actualCheckpoint: string | null;
  readonly expectedCheckpoint: string | null;

  constructor(
    accountKey: string,
    expectedCheckpoint: string | null,
    actualCheckpoint: string | null,
  ) {
    super(`checkpoint compare-and-swap failed for ${accountKey}`);
    this.name = "GatewayCheckpointConflictError";
    this.accountKey = accountKey;
    this.actualCheckpoint = actualCheckpoint;
    this.expectedCheckpoint = expectedCheckpoint;
  }
}

export class GatewayGenerationConflictError extends Error {
  readonly accountKey: string;
  readonly actualGeneration: number;
  readonly expectedGeneration: number;

  constructor(
    accountKey: string,
    expectedGeneration: number,
    actualGeneration: number,
  ) {
    super(`account generation mismatch for ${accountKey}`);
    this.name = "GatewayGenerationConflictError";
    this.accountKey = accountKey;
    this.actualGeneration = actualGeneration;
    this.expectedGeneration = expectedGeneration;
  }
}

export class GatewayLeaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayLeaseConflictError";
  }
}

export class GatewayOutboxConflictError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super(`operation id ${operationId} is already bound to another intent`);
    this.name = "GatewayOutboxConflictError";
    this.operationId = operationId;
  }
}
