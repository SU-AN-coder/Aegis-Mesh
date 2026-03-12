import type { DataSource } from "@aegis-mesh/shared";

import type { LiveSnapshot } from "./store";

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export interface LiveBindingStatus {
  mode: DataSource;
  rpcUrl: string;
  graphqlUrl: string | null;
  grpcUrl: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastSnapshot: LiveSnapshot | null;
  rpcHealthy: boolean;
  graphqlHealthy: boolean;
  grpcHealthy: boolean;
  lastGrpcEventSeq: string | null;
}

export class LiveUniverseAdapter {
  private readonly rpcUrl = process.env.SUI_RPC_URL ?? process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "http://localhost:9000";
  private readonly graphqlUrl = process.env.SUI_GRAPHQL_URL ?? process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL ?? null;
  private readonly grpcUrl = process.env.SUI_GRPC_URL ?? null;
  private mode: DataSource = (process.env.LIVE_DATA_MODE as DataSource) || "simulated";
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private lastSnapshot: LiveSnapshot | null = null;
  private rpcHealthy = false;
  private graphqlHealthy = false;
  private grpcHealthy = false;
  private lastGrpcEventSeq: string | null = null;
  private localEventCursor = 0;

  constructor() {
    if (this.mode !== "official_live" && this.mode !== "stale" && this.mode !== "simulated") {
      this.mode = "simulated";
    }
  }

  setMode(mode: DataSource) {
    this.mode = mode;
  }

  getMode(): DataSource {
    return this.mode;
  }

  async getSnapshot(): Promise<LiveSnapshot> {
    if (this.mode === "simulated") {
      return this.syntheticSnapshot("simulated", 1300);
    }

    try {
      const checkpoint = await this.fetchLatestCheckpoint();
      await Promise.all([this.probeGraphql(), this.probeGrpc()]);
      this.rpcHealthy = true;

      const checkpointNumber = Number.parseInt(checkpoint, 10);
      const from = this.localEventCursor === 0 ? checkpointNumber : this.localEventCursor;
      const to = Math.max(checkpointNumber, from);
      this.localEventCursor = to + 1;

      const snapshot: LiveSnapshot = {
        sourceSnapshotId: `checkpoint-${checkpoint}`,
        sourceEventRange: { from, to },
        dataFreshnessMs: 450,
        dataSource: this.mode,
        blockHeight: checkpointNumber,
      };

      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      this.lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "unknown-live-fetch-error";
      this.rpcHealthy = false;
      this.grpcHealthy = false;
      const fallback = this.syntheticSnapshot("stale", 8_000);
      this.lastSnapshot = fallback;
      return fallback;
    }
  }

  getStatus(): LiveBindingStatus {
    return {
      mode: this.mode,
      rpcUrl: this.rpcUrl,
      graphqlUrl: this.graphqlUrl,
      grpcUrl: this.grpcUrl,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      lastSnapshot: this.lastSnapshot,
      rpcHealthy: this.rpcHealthy,
      graphqlHealthy: this.graphqlHealthy,
      grpcHealthy: this.grpcHealthy,
      lastGrpcEventSeq: this.lastGrpcEventSeq,
    };
  }

  private async fetchLatestCheckpoint(): Promise<string> {
    const payload = {
      jsonrpc: "2.0",
      id: "aegis-checkpoint",
      method: "sui_getLatestCheckpointSequenceNumber",
      params: [],
    };

    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`rpc-http-${response.status}`);
    }

    const data = (await response.json()) as JsonRpcResponse<string>;
    if (data.error || !data.result) {
      throw new Error(data.error?.message ?? "rpc-empty-result");
    }
    return data.result;
  }

  private async probeGraphql(): Promise<void> {
    if (!this.graphqlUrl) {
      this.graphqlHealthy = false;
      return;
    }

    try {
      const response = await fetch(this.graphqlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "query AegisHealth { chainIdentifier }",
        }),
      });
      this.graphqlHealthy = response.ok;
    } catch {
      this.graphqlHealthy = false;
    }
  }

  private async probeGrpc(): Promise<void> {
    if (!this.grpcUrl) {
      this.grpcHealthy = false;
      return;
    }

    try {
      const response = await fetch(this.grpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "health",
        }),
      });
      if (!response.ok) {
        this.grpcHealthy = false;
        return;
      }
      const payload = (await response.json()) as {
        ok?: boolean;
        lastEventSeq?: string;
      };
      this.grpcHealthy = payload.ok === true;
      this.lastGrpcEventSeq = payload.lastEventSeq ?? null;
    } catch {
      this.grpcHealthy = false;
    }
  }

  private syntheticSnapshot(mode: DataSource, freshness: number): LiveSnapshot {
    const sequence = Math.floor(Date.now() / 1000);
    const snapshot: LiveSnapshot = {
      sourceSnapshotId: `${mode}-snapshot-${sequence}`,
      sourceEventRange: { from: sequence - 12, to: sequence },
      dataFreshnessMs: freshness,
      dataSource: mode,
      blockHeight: sequence,
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }
}

export const liveUniverse = new LiveUniverseAdapter();
