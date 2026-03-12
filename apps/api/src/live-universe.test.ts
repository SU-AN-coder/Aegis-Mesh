import assert from "node:assert/strict";
import test from "node:test";

import { LiveUniverseAdapter } from "./live-universe";

test("live universe adapter returns synthetic snapshots in simulated mode", async () => {
  const adapter = new LiveUniverseAdapter();
  adapter.setMode("simulated");

  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.dataSource, "simulated");
  assert.ok(snapshot.sourceSnapshotId.includes("simulated-snapshot-"));
  assert.equal(snapshot.sourceEventRange.from < snapshot.sourceEventRange.to, true);
});
