import assert from "node:assert/strict";
import test from "node:test";

import {
  FixedWindowRateLimiter,
  IdempotencyStore,
  SlidingWindowRateLimiter,
  TokenBucketRateLimiter,
  toRequestHash,
} from "./security";

test("rate limiter blocks requests over limit", () => {
  const limiter = new FixedWindowRateLimiter();
  const now = Date.now();

  const first = limiter.consume("key", 2, 10_000, now);
  const second = limiter.consume("key", 2, 10_000, now + 10);
  const third = limiter.consume("key", 2, 10_000, now + 20);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterMs > 0);
});

test("sliding window limiter blocks after limit in moving window", () => {
  const limiter = new SlidingWindowRateLimiter();
  const now = Date.now();

  const first = limiter.consume("s-key", 2, 1_000, now);
  const second = limiter.consume("s-key", 2, 1_000, now + 100);
  const blocked = limiter.consume("s-key", 2, 1_000, now + 200);
  const recovered = limiter.consume("s-key", 2, 1_000, now + 1_300);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(recovered.allowed, true);
});

test("idempotency store returns replay for same payload", () => {
  const store = new IdempotencyStore();
  const payload = { a: 1 };
  const hash = toRequestHash(payload);

  const begin = store.begin("idk", hash);
  assert.equal(begin.status, "created");

  store.complete("idk", 201, { ok: true });

  const replay = store.begin("idk", hash);
  assert.equal(replay.status, "replay");
  if (replay.status === "replay") {
    assert.equal(replay.statusCode, 201);
    assert.deepEqual(replay.responseBody, { ok: true });
  }
});

test("idempotency entries expire after ttl", async () => {
  const store = new IdempotencyStore(10);
  const hash = toRequestHash({ k: 1 });
  assert.equal(store.begin("ttl-key", hash).status, "created");
  store.complete("ttl-key", 200, { ok: true });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(store.begin("ttl-key", hash).status, "created");
});

test("token bucket limiter refills over time", () => {
  const limiter = new TokenBucketRateLimiter();
  const now = Date.now();

  const first = limiter.consume("bucket", 2, 1, 1, now);
  const second = limiter.consume("bucket", 2, 1, 1, now + 10);
  const third = limiter.consume("bucket", 2, 1, 1, now + 20);
  const recovered = limiter.consume("bucket", 2, 1, 1, now + 2_100);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(recovered.allowed, true);
});
