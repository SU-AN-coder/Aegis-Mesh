import type {
  DistressBeacon,
  IncidentCase,
  IntelMessage,
  NodeRegistration,
  PolicyProfile,
  RouteMode,
  RouteQuote,
} from "./protocol";

const DEFAULT_SOURCE_SNAPSHOT = "snapshot-2026-03-09T12:00:00Z";

export const defaultPolicy: PolicyProfile = {
  mode: "wartime",
  tollBase: 12,
  riskMultiplier: 1.4,
  civilianProtection: true,
  treatyExemptions: ["alliance-beta"],
  redlist: ["pilot-red-01", "pilot-red-02"],
  whitelist: ["pilot-blue-01"],
};

export const mockNodes: NodeRegistration[] = [
  {
    nodeId: "gate-alpha-7",
    allianceId: "alliance-alpha",
    kind: "gate",
    label: "Alpha Border Gate",
    systemId: "stillness-alpha-7",
    assemblyId: "assembly-alpha-gate-7",
    policyId: "policy-border-west",
    positionHash: "0xabc123",
    updatedAt: new Date().toISOString(),
  },
  {
    nodeId: "gate-beta-3",
    allianceId: "alliance-alpha",
    kind: "gate",
    label: "Convoy Corridor",
    systemId: "stillness-beta-3",
    assemblyId: "assembly-alpha-gate-3",
    policyId: "policy-convoy",
    positionHash: "0xabc456",
    updatedAt: new Date().toISOString(),
  },
  {
    nodeId: "turret-sigma-2",
    allianceId: "alliance-alpha",
    kind: "turret",
    label: "Sigma Defense Ring",
    systemId: "stillness-sigma-2",
    assemblyId: "assembly-alpha-turret-2",
    policyId: "policy-sigma-defense",
    positionHash: "0xabc789",
    updatedAt: new Date().toISOString(),
  },
];

export function buildRouteQuote(mode: RouteMode): RouteQuote {
  const baseRisk = mode === "safe" ? 18 : mode === "cheap" ? 49 : 33;
  const baseCost = mode === "cheap" ? 14 : mode === "fast" ? 28 : 20;
  const score = mode === "safe" ? 91 : mode === "cheap" ? 83 : 87;

  return {
    from: "stillness-alpha-7",
    to: "trade-hub-iv",
    mode,
    score,
    estimatedRisk: baseRisk,
    estimatedCost: baseCost,
    sourceSnapshotId: DEFAULT_SOURCE_SNAPSHOT,
    sourceEventRange: { from: 15020, to: 15138 },
    dataFreshnessMs: mode === "fast" ? 900 : 1300,
    riskBreakdown: [
      { factor: "killmail_density", contribution: Math.round(baseRisk * 0.5) },
      { factor: "distress_heat", contribution: Math.round(baseRisk * 0.35) },
      { factor: "policy_modifier", contribution: Math.round(baseRisk * 0.15) },
    ],
    tollBreakdown: [
      { factor: "base_toll", amount: Math.max(6, baseCost - 4) },
      { factor: "risk_multiplier", amount: 3 },
      { factor: "sponsor_fee", amount: 1 },
    ],
    blockedByPolicy: [],
    dataSource: "simulated",
    summary:
      mode === "safe"
        ? "Recommended convoy path minimizes redlist exposure and recent killmail density."
        : mode === "cheap"
          ? "Budget route accepts higher contested-space exposure for lower gate tolls."
          : "Fast route minimizes hops and recent distress detours.",
    hops: [
      {
        nodeId: "gate-alpha-7",
        label: "Alpha Border Gate",
        systemId: "stillness-alpha-7",
        risk: baseRisk - 5,
        toll: Math.max(6, baseCost - 6),
      },
      {
        nodeId: "gate-beta-3",
        label: "Convoy Corridor",
        systemId: "stillness-beta-3",
        risk: baseRisk,
        toll: Math.max(8, baseCost - 2),
      },
    ],
  };
}

export const mockBeacons: DistressBeacon[] = [
  {
    beaconId: "beacon-001",
    allianceId: "alliance-alpha",
    characterId: "pilot-blue-01",
    systemId: "stillness-beta-3",
    threatLevel: "high",
    bondAmount: 5,
    status: "open",
    openedAt: new Date().toISOString(),
    responders: [],
    sourceSnapshotId: DEFAULT_SOURCE_SNAPSHOT,
    dataSource: "simulated",
    chainDigest: null,
  },
];

export const mockIncidents: IncidentCase[] = [
  {
    incidentId: "incident-001",
    beaconId: "beacon-001",
    killmailRef: "killmail-0xdeadbeef",
    allianceId: "alliance-alpha",
    verdict: "pending",
    title: "Border convoy ambush",
    summary: "Killmail-linked ambush flagged for operator review and responder payout.",
    operatorComment: "Awaiting auditor review before insurer payout.",
    status: "evidence_attached",
    evidenceCount: 2,
    evidenceHashes: ["walrus://evidence-001", "walrus://evidence-002"],
    auditorApproved: false,
    auditorAddress: null,
    auditorComment: null,
    insurerApproved: false,
    insurerAddress: null,
    insurerComment: null,
    payoutTotal: 0,
    payoutExecutedAt: null,
    resolvedAtMs: null,
    updatedAt: new Date().toISOString(),
    sourceSnapshotId: DEFAULT_SOURCE_SNAPSHOT,
    sourceEventRange: { from: 15080, to: 15139 },
    chainDigest: null,
    chainEventSeq: null,
  },
];

export const mockIntel: IntelMessage[] = [
  {
    id: "intel-001",
    kind: "threat",
    channel: "intel.threat",
    sequence: 1,
    dataSource: "simulated",
    headline: "Threat spike on convoy corridor",
    summary: "Killmail density and open distress traffic suggest elevated intercept risk in stillness-beta-3.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "intel-002",
    kind: "policy",
    channel: "intel.policy",
    sequence: 2,
    dataSource: "simulated",
    headline: "Policy suggestion: switch border gate to blockade",
    summary: "Redlist activity exceeded wartime threshold for two consecutive windows.",
    createdAt: new Date().toISOString(),
  },
];
