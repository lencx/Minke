export interface RecoverableGatewayMailbox {
  recover(input?: { readonly now?: number }): unknown;
}

export type GatewayMailboxRecovery = ((
  mailbox: RecoverableGatewayMailbox,
) => void) & {
  reset?: () => void;
};

type RecoveryOutcome =
  | { readonly status: "complete" }
  | { readonly status: "failed"; readonly error: unknown };

/**
 * Coordinate SQLite mailbox recovery across every IM capability in one Host.
 *
 * Recovery mutates global inbox/outbox lease state, so it is a Host-startup
 * operation rather than a per-provider reconnect step. Both success and
 * failure are memoized; a second channel observes the first result without
 * running another global recovery pass.
 */
export function createGatewayMailboxRecovery(): GatewayMailboxRecovery {
  let outcome: RecoveryOutcome | undefined;
  const recover: GatewayMailboxRecovery = (mailbox): void => {
    if (outcome?.status === "complete") return;
    if (outcome?.status === "failed") throw outcome.error;
    try {
      mailbox.recover();
      outcome = { status: "complete" };
    } catch (error) {
      outcome = { status: "failed", error };
      throw error;
    }
  };
  recover.reset = (): void => {
    outcome = undefined;
  };
  return recover;
}
