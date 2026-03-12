import assert from "node:assert/strict";
import test from "node:test";

import { AegisStore } from "./store";

test("store returns route quotes and persists incidents", () => {
  const store = new AegisStore();
  const quote = store.quoteRoute("fast", "stillness-a", "stillness-b");
  assert.equal(quote.mode, "fast");
  assert.equal(quote.from, "stillness-a");
  assert.ok(quote.hops.length > 0);
  assert.equal(quote.sourceEventRange.from < quote.sourceEventRange.to, true);

  store.upsertIncident({
    incidentId: "incident-test",
    allianceId: "alliance-alpha",
    killmailRef: null,
    verdict: "pending",
    title: "Test incident",
    summary: "Synthetic incident",
    evidenceCount: 1,
    updatedAt: new Date().toISOString(),
  });

  const incident = store.getIncident("incident-test");
  assert.equal(incident?.title, "Test incident");
  assert.ok(incident?.sourceSnapshotId);
});

test("store dedupes distress beacons in the same system window", () => {
  const store = new AegisStore();

  const first = store.createOrUpdateDistress({
    beaconId: "beacon-test-1",
    allianceId: "alliance-alpha",
    characterId: "pilot-blue-01",
    systemId: "stillness-alpha-7",
    threatLevel: "high",
    bondAmount: 5,
    chainDigest: null,
  });

  const second = store.createOrUpdateDistress({
    beaconId: "beacon-test-2",
    allianceId: "alliance-alpha",
    characterId: "pilot-blue-01",
    systemId: "stillness-alpha-7",
    threatLevel: "critical",
    bondAmount: 7,
    chainDigest: null,
  });

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.beacon.beaconId, second.beacon.beaconId);
  assert.equal(second.beacon.threatLevel, "critical");
});

test("store accepts single responder per beacon", () => {
  const store = new AegisStore();

  const created = store.createOrUpdateDistress({
    beaconId: "beacon-r-1",
    allianceId: "alliance-alpha",
    characterId: "pilot-1",
    systemId: "stillness-zeta",
    threatLevel: "high",
    bondAmount: 4,
    chainDigest: null,
  });

  const firstAccept = store.acceptResponder({
    beaconId: created.beacon.beaconId,
    responderId: "responder-01",
    bondAmount: 10,
  });
  const duplicateAccept = store.acceptResponder({
    beaconId: created.beacon.beaconId,
    responderId: "responder-01",
    bondAmount: 10,
  });

  assert.ok(firstAccept);
  assert.equal(firstAccept?.responders.length, 1);
  assert.equal(duplicateAccept, null);
});

test("policy proposal approval applies policy changes and keeps history", () => {
  const store = new AegisStore();

  const proposal = store.proposePolicyChange({
    policyId: "policy-border-west",
    allianceId: "alliance-alpha",
    proposer: "operator-01",
    reason: "combat spike",
    changes: {
      mode: "blockade",
      riskMultiplier: 1.9,
    },
  });

  const approved = store.approvePolicyProposal(proposal.proposalId, "auditor-01", "approved for escalation", 2);
  assert.ok(approved);
  assert.equal(approved?.status, "proposed");

  const finalized = store.approvePolicyProposal(proposal.proposalId, "treaty-01", "second approval", 8);
  assert.ok(finalized);
  assert.equal(finalized?.status, "approved");

  const policy = store.getPolicy("policy-border-west");
  assert.equal(policy?.mode, "blockade");
  assert.equal(policy?.riskMultiplier, 1.9);

  const versions = store.listPolicyVersions("policy-border-west");
  assert.ok(versions.length >= 2);
});

test("non high-risk policy proposal is finalized by a single approval", () => {
  const store = new AegisStore();
  const proposal = store.proposePolicyChange({
    policyId: "policy-convoy",
    allianceId: "alliance-alpha",
    proposer: "operator-01",
    reason: "small toll adjustment",
    changes: {
      tollBase: 11,
      civilianProtection: true,
    },
  });

  const approved = store.approvePolicyProposal(proposal.proposalId, "auditor-01", "ok", 2);
  assert.ok(approved);
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.requiredApprovals, 1);
});

test("incident requires auditor approval before insurer payout", () => {
  const store = new AegisStore();

  const incident = store.upsertIncident({
    incidentId: "incident-approval-flow",
    beaconId: null,
    allianceId: "alliance-alpha",
    killmailRef: "killmail-1",
    verdict: "pending",
    title: "Flow",
    summary: "Flow case",
    operatorComment: null,
    evidenceCount: 2,
    updatedAt: new Date().toISOString(),
  });

  const earlyPayout = store.insurerApproveAndExecutePayout(
    incident.incidentId,
    "insurer-01",
    "attempt too early",
    [{ recipient: "pilot-1", amount: 5 }],
  );
  assert.equal(earlyPayout, null);

  const auditorApproved = store.auditorApproveIncident(incident.incidentId, "auditor-01", "evidence valid");
  assert.ok(auditorApproved);
  assert.equal(auditorApproved?.status, "auditor_approved");

  const payout = store.insurerApproveAndExecutePayout(
    incident.incidentId,
    "insurer-01",
    "execute",
    [{ recipient: "pilot-1", amount: 5 }],
  );
  assert.ok(payout);
  assert.equal(payout?.status, "payout_executed");
  assert.equal(payout?.verdict, "confirmed");
  assert.equal(payout?.payoutTotal, 5);
  assert.ok((payout?.resolvedAtMs ?? 0) > 0);
});

test("incident evidence hashes are append-only and deduplicated", () => {
  const store = new AegisStore();

  const first = store.upsertIncident({
    incidentId: "incident-evidence-1",
    beaconId: null,
    allianceId: "alliance-alpha",
    killmailRef: null,
    verdict: "pending",
    title: "Evidence case",
    summary: "Round 1",
    operatorComment: "r1",
    evidenceCount: 1,
    evidenceHashes: ["walrus://hash-1"],
    updatedAt: new Date().toISOString(),
  });

  const second = store.upsertIncident({
    incidentId: "incident-evidence-1",
    beaconId: null,
    allianceId: "alliance-alpha",
    killmailRef: null,
    verdict: "pending",
    title: "Evidence case",
    summary: "Round 2",
    operatorComment: "r2",
    evidenceCount: 1,
    evidenceHashes: ["walrus://hash-1", "walrus://hash-2"],
    updatedAt: new Date().toISOString(),
  });

  assert.equal(first.evidenceHashes.length, 1);
  assert.equal(second.evidenceHashes.length, 2);
  assert.deepEqual(second.evidenceHashes, ["walrus://hash-1", "walrus://hash-2"]);
});

test("route pass can be issued and consumed with permit digest", () => {
  const store = new AegisStore();
  const pass = store.issueRoutePass({
    routePassId: "route-pass-1",
    allianceId: "alliance-alpha",
    characterId: "pilot-1",
    sourceGateId: "gate-alpha-7",
    destinationGateId: "gate-beta-3",
    routeFingerprint: "a->b:safe",
    sponsorProvider: "custom",
    quotedCost: 12,
    quotedRisk: 20,
    sourceSnapshotId: "snapshot-1",
    permitExpiresAtMs: Date.now() + 1_000,
    expiresAt: new Date(Date.now() + 1_000).toISOString(),
  });
  assert.equal(pass.consumed, false);
  assert.equal(pass.sourceGateId, "gate-alpha-7");
  assert.equal(pass.destinationGateId, "gate-beta-3");
  assert.ok(pass.permitExpiresAtMs > 0);

  const consumed = store.markRoutePassConsumed("route-pass-1", "0xabc");
  assert.ok(consumed);
  assert.equal(consumed?.consumed, true);
  assert.equal(consumed?.linkedPermitDigest, "0xabc");
});

test("gate linking check follows configured links", () => {
  const store = new AegisStore();
  assert.equal(store.isValidGateLink("gate-alpha-7", "gate-beta-3"), true);
  assert.equal(store.isValidGateLink("gate-beta-3", "gate-alpha-7"), true);
  assert.equal(store.isValidGateLink("gate-alpha-7", "gate-unknown"), false);
});
