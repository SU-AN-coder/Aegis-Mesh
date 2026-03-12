import { store } from "./store";

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface SuiEventPage {
  data: Array<{
    id: {
      txDigest: string;
      eventSeq: string;
    };
    packageId: string;
    transactionModule: string;
    type: string;
    parsedJson?: Record<string, unknown>;
    timestampMs?: string;
  }>;
  nextCursor: {
    txDigest: string;
    eventSeq: string;
  } | null;
  hasNextPage: boolean;
}

interface SuiTransactionBlock {
  digest: string;
  effects?: {
    status?: {
      status?: "success" | "failure";
      error?: string;
    };
  };
  objectChanges?: Array<{
    type?: string;
    objectType?: string;
    objectId?: string;
  }>;
}

export interface IndexerStatus {
  enabled: boolean;
  running: boolean;
  pollIntervalMs: number;
  lastPollAt: string | null;
  lastError: string | null;
  totalEvents: number;
  lastCursor: {
    txDigest: string;
    eventSeq: string;
  } | null;
  pendingRoutePasses: number;
}

export class EventIndexer {
  private readonly rpcUrl = process.env.SUI_RPC_URL ?? process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "http://localhost:9000";
  private readonly pollIntervalMs = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? "3000");
  private readonly enabled = process.env.INDEXER_ENABLED === "true";
  private readonly jumpPermitTypeSuffix = "::gate::JumpPermit";
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;
  private totalEvents = 0;
  private lastCursor: { txDigest: string; eventSeq: string } | null = null;

  start(): void {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
    void this.pollOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  async pollOnce(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await Promise.all([this.pollEvents(), this.pollPendingRoutePasses()]);
      this.lastPollAt = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "indexer-poll-failed";
      this.lastPollAt = new Date().toISOString();
    }
  }

  private async pollEvents(): Promise<void> {
    const payload = {
      jsonrpc: "2.0",
      id: "aegis-indexer-events",
      method: "suix_queryEvents",
      params: [{ All: [] }, this.lastCursor, 50, false],
    };

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`indexer-http-${response.status}`);
    }

    const data = (await response.json()) as JsonRpcResponse<SuiEventPage>;
    if (data.error || !data.result) {
      throw new Error(data.error?.message ?? "indexer-empty-result");
    }

    this.totalEvents += data.result.data.length;
    this.lastCursor = data.result.nextCursor;
  }

  private async pollPendingRoutePasses(): Promise<void> {
    const pending = store.listPendingRoutePasses();
    if (pending.length === 0) {
      return;
    }

    await Promise.all(
      pending.map(async (pass) => {
        if (!pass.submittedPermitDigest) {
          return;
        }
        store.touchRoutePassConfirmation(pass.routePassId);
        const tx = await this.fetchTransaction(pass.submittedPermitDigest);
        if (!tx) {
          return;
        }
        const txStatus = tx.effects?.status?.status;
        if (txStatus === "failure") {
          store.failRoutePassConfirmation(
            pass.routePassId,
            tx.effects?.status?.error ?? "official-transaction-failed",
          );
          return;
        }
        if (txStatus !== "success") {
          return;
        }
        if (this.hasIssuedJumpPermit(tx)) {
          store.markRoutePassConsumed(pass.routePassId, pass.submittedPermitDigest);
          return;
        }
        store.failRoutePassConfirmation(
          pass.routePassId,
          "official-transaction-confirmed-without-jump-permit-object",
        );
      }),
    );
  }

  private async fetchTransaction(digest: string): Promise<SuiTransactionBlock | null> {
    const payload = {
      jsonrpc: "2.0",
      id: "aegis-indexer-tx",
      method: "sui_getTransactionBlock",
      params: [digest, { showEffects: true, showObjectChanges: true }],
    };

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`indexer-tx-http-${response.status}`);
    }

    const data = (await response.json()) as JsonRpcResponse<SuiTransactionBlock>;
    if (data.error) {
      if (this.isTransactionPending(data.error.message)) {
        return null;
      }
      throw new Error(data.error.message);
    }
    return data.result ?? null;
  }

  private isTransactionPending(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes("not found") || normalized.includes("pending");
  }

  private hasIssuedJumpPermit(tx: SuiTransactionBlock): boolean {
    return (
      tx.objectChanges?.some((change) => {
        const objectType = change.objectType ?? "";
        return (
          (change.type === "created" || change.type === "transferred") &&
          objectType.endsWith(this.jumpPermitTypeSuffix)
        );
      }) ?? false
    );
  }

  getStatus(): IndexerStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      pollIntervalMs: this.pollIntervalMs,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      totalEvents: this.totalEvents,
      lastCursor: this.lastCursor,
      pendingRoutePasses: store.listPendingRoutePasses().length,
    };
  }
}

export const eventIndexer = new EventIndexer();
