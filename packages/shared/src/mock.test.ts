import assert from "node:assert/strict";
import test from "node:test";

import { buildRouteQuote } from "./mock";

test("buildRouteQuote produces different profiles", () => {
  const safe = buildRouteQuote("safe");
  const cheap = buildRouteQuote("cheap");

  assert.equal(safe.mode, "safe");
  assert.equal(cheap.mode, "cheap");
  assert.ok(safe.estimatedRisk < cheap.estimatedRisk);
  assert.ok(safe.score > cheap.score);
  assert.equal(safe.sourceEventRange.from < safe.sourceEventRange.to, true);
  assert.ok(safe.riskBreakdown.length > 0);
  assert.equal(safe.dataSource, "simulated");
});
