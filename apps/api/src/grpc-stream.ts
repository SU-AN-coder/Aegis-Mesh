export interface GrpcStreamEvent {
  eventSeq: string;
  channel: string;
  headline: string;
  summary: string;
  digest: string | null;
  createdAt: string;
}

export interface GrpcStreamStatus {
  enabled: boolean;
  running: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  lastEventSeq: string | null;
  totalEvents: number;
}

type EventHandler = (event: GrpcStreamEvent) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEventLine(line: string): GrpcStreamEvent | null {
  if (!line.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(line) as {
      eventSeq?: string;
      channel?: string;
      headline?: string;
      summary?: string;
      digest?: string;
      createdAt?: string;
    };
    if (!payload.eventSeq || !payload.channel || !payload.headline || !payload.summary) {
      return null;
    }
    return {
      eventSeq: payload.eventSeq,
      channel: payload.channel,
      headline: payload.headline,
      summary: payload.summary,
      digest: payload.digest ?? null,
      createdAt: payload.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export class GrpcEventStream {
  private readonly streamUrl = process.env.SUI_GRPC_EVENTS_URL ?? null;
  private readonly enabled = Boolean(process.env.SUI_GRPC_EVENTS_URL);
  private running = false;
  private abort: AbortController | null = null;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private lastEventSeq: string | null = null;
  private totalEvents = 0;
  private reconnectBackoffMs = 1_000;
  private readonly maxBackoffMs = 10_000;

  constructor(private readonly onEvent: EventHandler) {}

  start(): void {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    void this.run();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
  }

  getStatus(): GrpcStreamStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      lastEventSeq: this.lastEventSeq,
      totalEvents: this.totalEvents,
    };
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.consumeStream();
        this.reconnectBackoffMs = 1_000;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "grpc-stream-error";
        await sleep(this.reconnectBackoffMs);
        this.reconnectBackoffMs = Math.min(this.reconnectBackoffMs * 2, this.maxBackoffMs);
      }
    }
  }

  private async consumeStream(): Promise<void> {
    if (!this.streamUrl) {
      throw new Error("grpc-stream-url-not-configured");
    }

    this.abort = new AbortController();
    const response = await fetch(this.streamUrl, {
      method: "GET",
      signal: this.abort.signal,
      headers: {
        Accept: "application/x-ndjson, application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`grpc-stream-http-${response.status}`);
    }
    if (!response.body) {
      throw new Error("grpc-stream-empty-body");
    }

    this.lastConnectedAt = new Date().toISOString();
    this.lastError = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (this.running) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        const event = parseEventLine(line);
        if (event) {
          this.totalEvents += 1;
          this.lastEventSeq = event.eventSeq;
          this.onEvent(event);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  }
}
