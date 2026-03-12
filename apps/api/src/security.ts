import { createHash, randomUUID } from "node:crypto";

export interface ApiErrorBody {
  errorCode: string;
  message: string;
  requestId: string;
  retryAfterMs?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

interface IdempotencyRecord {
  requestHash: string;
  state: "in_flight" | "completed";
  statusCode?: number;
  responseBody?: unknown;
  createdAt: number;
  expiresAt: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    const existing = this.buckets.get(key);

    if (!existing || now >= existing.resetAt) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: Math.max(limit - 1, 0),
      };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(existing.resetAt - now, 1),
        remaining: 0,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.max(limit - existing.count, 0),
    };
  }
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitDecision {
    const windowStart = now - windowMs;
    const previousHits = this.hits.get(key) ?? [];
    const activeHits = previousHits.filter((hit) => hit > windowStart);

    if (activeHits.length >= limit) {
      const earliest = activeHits[0] ?? now;
      const retryAfterMs = Math.max(1, earliest + windowMs - now);
      this.hits.set(key, activeHits);
      return {
        allowed: false,
        retryAfterMs,
        remaining: 0,
      };
    }

    activeHits.push(now);
    this.hits.set(key, activeHits);
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.max(0, limit - activeHits.length),
    };
  }
}

export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  private sweep(now = Date.now()): void {
    for (const [key, record] of this.records.entries()) {
      if (now >= record.expiresAt) {
        this.records.delete(key);
      }
    }
  }

  begin(key: string, requestHash: string):
    | { status: "created" }
    | { status: "replay"; statusCode: number; responseBody: unknown }
    | { status: "conflict" } {
    const now = Date.now();
    this.sweep(now);
    const record = this.records.get(key);
    if (!record) {
      this.records.set(key, {
        requestHash,
        state: "in_flight",
        createdAt: now,
        expiresAt: now + this.ttlMs,
      });
      return { status: "created" };
    }

    if (record.requestHash !== requestHash) {
      return { status: "conflict" };
    }

    if (record.state === "completed") {
      return {
        status: "replay",
        statusCode: record.statusCode ?? 200,
        responseBody: record.responseBody ?? null,
      };
    }

    return { status: "conflict" };
  }

  complete(key: string, statusCode: number, responseBody: unknown): void {
    const record = this.records.get(key);
    if (!record) {
      return;
    }
    record.state = "completed";
    record.statusCode = statusCode;
    record.responseBody = responseBody;
  }

  fail(key: string): void {
    this.records.delete(key);
  }
}

export class FailureGuard {
  private readonly failures = new Map<string, { count: number; cooldownUntil: number }>();

  isCooling(key: string, now = Date.now()): number {
    const state = this.failures.get(key);
    if (!state) {
      return 0;
    }
    if (now >= state.cooldownUntil) {
      this.failures.delete(key);
      return 0;
    }
    return state.cooldownUntil - now;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  recordFailure(key: string, now = Date.now(), threshold = 5, cooldownMs = 60_000): void {
    const state = this.failures.get(key);
    if (!state) {
      this.failures.set(key, { count: 1, cooldownUntil: 0 });
      return;
    }

    state.count += 1;
    if (state.count >= threshold) {
      state.cooldownUntil = now + cooldownMs;
    }
  }
}

interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, TokenBucketState>();

  consume(
    key: string,
    capacity: number,
    refillPerSecond: number,
    cost = 1,
    now = Date.now(),
  ): RateLimitDecision {
    const refillPerMs = refillPerSecond / 1000;
    const existing = this.buckets.get(key) ?? {
      tokens: capacity,
      lastRefillMs: now,
    };

    const elapsed = Math.max(0, now - existing.lastRefillMs);
    const refilled = Math.min(capacity, existing.tokens + elapsed * refillPerMs);

    if (refilled < cost) {
      const missing = cost - refilled;
      const retryAfterMs = Math.max(1, Math.ceil(missing / refillPerMs));
      this.buckets.set(key, {
        tokens: refilled,
        lastRefillMs: now,
      });
      return {
        allowed: false,
        retryAfterMs,
        remaining: Math.floor(refilled),
      };
    }

    const remainingTokens = refilled - cost;
    this.buckets.set(key, {
      tokens: remainingTokens,
      lastRefillMs: now,
    });
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: Math.floor(remainingTokens),
    };
  }
}

export function toRequestHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildApiError(
  errorCode: string,
  message: string,
  requestId?: string,
  retryAfterMs?: number,
): ApiErrorBody {
  return {
    errorCode,
    message,
    requestId: requestId ?? randomUUID(),
    retryAfterMs,
  };
}
