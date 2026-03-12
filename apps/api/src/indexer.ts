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
}

export class EventIndexer {
  private readonly rpcUrl = process.env.SUI_RPC_URL ?? process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "http://localhost:9000";
  private readonly pollIntervalMs = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? "3000");
  private readonly enabled = process.env.INDEXER_ENABLED === "true";
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
      const payload = {
        jsonrpc: "2.0",
        id: "aegis-indexer",
        method: "suix_queryEvents",
        params: [
          { All: [] },
          this.lastCursor,
          50,
          false,
        ],
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

      this.lastPollAt = new Date().toISOString();
      this.lastError = null;
      this.totalEvents += data.result.data.length;
      this.lastCursor = data.result.nextCursor;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "indexer-poll-failed";
      this.lastPollAt = new Date().toISOString();
    }
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
    };
  }
}

export const eventIndexer = new EventIndexer();
