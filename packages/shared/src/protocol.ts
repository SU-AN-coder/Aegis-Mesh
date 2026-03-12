export type NodeKind = "gate" | "turret" | "storage";
export type PolicyMode = "ceasefire" | "blockade" | "wartime";
export type RouteMode = "safe" | "cheap" | "fast";
export type BeaconStatus = "open" | "claimed" | "resolved" | "expired";
export type IncidentVerdict = "pending" | "confirmed" | "rejected";
export type IncidentStatus =
  | "open"
  | "evidence_attached"
  | "auditor_approved"
  | "confirmed"
  | "rejected"
  | "payout_executed";
export type DataSource = "official_live" | "simulated" | "stale";
export type SponsorProvider = "dapp-kit" | "custom";

export interface PolicyProfile {
  mode: PolicyMode;
  tollBase: number;
  riskMultiplier: number;
  civilianProtection: boolean;
  treatyExemptions: string[];
  redlist: string[];
  whitelist: string[];
}

export interface NodeRegistration {
  nodeId: string;
  allianceId: string;
  kind: NodeKind;
  label: string;
  systemId: string;
  assemblyId: string;
  policyId: string;
  positionHash: string;
  updatedAt: string;
}

export interface RouteQuote {
  from: string;
  to: string;
  mode: RouteMode;
  score: number;
  estimatedRisk: number;
  estimatedCost: number;
  hops: Array<{
    nodeId: string;
    label: string;
    systemId: string;
    risk: number;
    toll: number;
  }>;
  sourceSnapshotId: string;
  sourceEventRange: {
    from: number;
    to: number;
  };
  dataFreshnessMs: number;
  riskBreakdown: Array<{
    factor: string;
    contribution: number;
  }>;
  tollBreakdown: Array<{
    factor: string;
    amount: number;
  }>;
  blockedByPolicy: string[];
  dataSource: DataSource;
  summary: string;
}

export interface DistressBeacon {
  beaconId: string;
  allianceId: string;
  characterId: string;
  systemId: string;
  threatLevel: "low" | "medium" | "high" | "critical";
  bondAmount: number;
  status: BeaconStatus;
  openedAt: string;
  responders: Array<{
    responderId: string;
    bondAmount: number;
    acceptedAt: string;
  }>;
  sourceSnapshotId: string;
  dataSource: DataSource;
  chainDigest: string | null;
}

export interface IncidentCase {
  incidentId: string;
  beaconId: string | null;
  killmailRef: string | null;
  allianceId: string;
  verdict: IncidentVerdict;
  title: string;
  summary: string;
  operatorComment: string | null;
  status: IncidentStatus;
  evidenceCount: number;
  evidenceHashes: string[];
  auditorApproved: boolean;
  auditorAddress: string | null;
  auditorComment: string | null;
  insurerApproved: boolean;
  insurerAddress: string | null;
  insurerComment: string | null;
  payoutTotal: number;
  payoutExecutedAt: string | null;
  resolvedAtMs: number | null;
  updatedAt: string;
  sourceSnapshotId: string;
  sourceEventRange: {
    from: number;
    to: number;
  };
  chainDigest: string | null;
  chainEventSeq: string | null;
}

export interface RoutePassRecord {
  routePassId: string;
  allianceId: string;
  characterId: string;
  sourceGateId: string;
  destinationGateId: string;
  routeFingerprint: string;
  sponsorProvider: SponsorProvider;
  quotedCost: number;
  quotedRisk: number;
  sourceSnapshotId: string;
  permitExpiresAtMs: number;
  issuedAt: string;
  expiresAt: string;
  consumed: boolean;
  linkedPermitDigest: string | null;
}

export interface PolicyVersionSnapshot {
  version: number;
  changedBy: string;
  changedAt: string;
  reason: string;
  profile: PolicyProfile;
}

export interface PolicyProposal {
  proposalId: string;
  policyId: string;
  allianceId: string;
  proposer: string;
  approver: string | null;
  status: "proposed" | "approved" | "rejected";
  requiresDualApproval: boolean;
  requiredApprovals: number;
  reason: string;
  approverComment: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvals: Array<{
    approver: string;
    role: "auditor" | "treaty_admin";
    comment: string;
    approvedAt: string;
  }>;
  changes: Partial<PolicyProfile>;
}

export interface IntelMessage {
  id: string;
  kind: "threat" | "claims" | "policy";
  channel: "intel.threat" | "intel.claims" | "intel.policy";
  sequence: number;
  dataSource: DataSource;
  headline: string;
  summary: string;
  createdAt: string;
}
