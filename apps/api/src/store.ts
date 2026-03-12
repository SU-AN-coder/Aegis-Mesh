import { createHash, randomUUID } from "node:crypto";

import {
  buildRouteQuote,
  defaultPolicy,
  mockBeacons,
  mockIncidents,
  mockIntel,
  mockNodes,
  type DataSource,
  type DistressBeacon,
  type IncidentCase,
  type IncidentStatus,
  type IntelMessage,
  type NodeRegistration,
  type PolicyProfile,
  type PolicyProposal,
  type PolicyVersionSnapshot,
  type RoutePassRecord,
  type RouteMode,
  type RouteQuote,
} from "@aegis-mesh/shared";

export interface LiveSnapshot {
  sourceSnapshotId: string;
  sourceEventRange: {
    from: number;
    to: number;
  };
  dataFreshnessMs: number;
  dataSource: DataSource;
  blockHeight?: number;
}

export interface DistressInput {
  beaconId: string;
  allianceId: string;
  characterId: string;
  systemId: string;
  threatLevel: DistressBeacon["threatLevel"];
  bondAmount: number;
  locationProofHash: string | null;
  chainDigest: string | null;
}

export interface ResponderAcceptInput {
  beaconId: string;
  responderId: string;
  bondAmount: number;
}

export interface RoutePassIssueInput {
  routePassId: string;
  allianceId: string;
  characterId: string;
  actorAddress: string;
  sourceGateId: string;
  destinationGateId: string;
  routeFingerprint: string;
  sponsorProvider: "dapp-kit" | "custom";
  quotedCost: number;
  quotedRisk: number;
  sourceSnapshotId: string;
  permitExpiresAtMs: number;
  expiresAt: string;
}

export interface SponsorReservation {
  allowed: boolean;
  remaining: number;
}

export interface PayoutItem {
  recipient: string;
  amount: number;
}

export interface WriteAuditRecord {
  requestId: string;
  endpoint: string;
  actor: string;
  roleBits: number;
  allianceId: string;
  idempotencyKey: string;
  sourceSnapshotId: string;
  result: "success" | "failed";
  txDigest?: string | null;
  createdAt: string;
}

export interface PolicyProposalInput {
  policyId: string;
  allianceId: string;
  proposer: string;
  reason: string;
  changes: Partial<PolicyProfile>;
}

export interface RuntimeMetrics {
  startedAt: string;
  dataSource: DataSource;
  totalRequests: number;
  writeRequests: number;
  rateLimitHits: number;
  idempotencyReplays: number;
  sponsorAttempts: number;
  sponsorSuccess: number;
  sponsorAttemptsDappKit: number;
  sponsorSuccessDappKit: number;
  sponsorAttemptsCustom: number;
  sponsorSuccessCustom: number;
  routePassAwaitingWallet: number;
  routePassPendingConfirmation: number;
  routePassConfirmed: number;
  routePassFailed: number;
  distressRaised: number;
  distressDeduped: number;
  distressResponded: number;
  incidentAuditorApprovals: number;
  incidentInsurerApprovals: number;
  payoutsExecuted: number;
  wsBroadcasts: number;
  wsConnectionsCurrent: number;
  wsConnectionsPeak: number;
  grpcEventsIngested: number;
  endpointP95: Record<string, number>;
}

function resolveDataSource(): DataSource {
  const mode = process.env.LIVE_DATA_MODE;
  if (mode === "official_live" || mode === "stale") {
    return mode;
  }
  return "simulated";
}

function parseIsoMs(value: string): number {
  return new Date(value).getTime();
}

function isHighRiskPolicyChange(changes: Partial<PolicyProfile>): boolean {
  return (
    changes.mode !== undefined ||
    changes.riskMultiplier !== undefined ||
    changes.treatyExemptions !== undefined
  );
}

const ROLE_AUDITOR = 1 << 1;
const ROLE_TREATY_ADMIN = 1 << 3;

export class AegisStore {
  private readonly nodes = new Map<string, NodeRegistration>(
    mockNodes.map((node) => [node.nodeId, node]),
  );

  private readonly policies = new Map<string, PolicyProfile>([
    ["policy-border-west", defaultPolicy],
    ["policy-convoy", { ...defaultPolicy, mode: "ceasefire", tollBase: 8, riskMultiplier: 1.05 }],
    ["policy-sigma-defense", { ...defaultPolicy, mode: "blockade", tollBase: 24, riskMultiplier: 1.8 }],
  ]);

  private readonly policyVersions = new Map<string, PolicyVersionSnapshot[]>();
  private readonly policyProposals = new Map<string, PolicyProposal>();

  private readonly beacons = new Map<string, DistressBeacon>(
    mockBeacons.map((beacon) => [beacon.beaconId, beacon]),
  );

  private readonly incidents = new Map<string, IncidentCase>(
    mockIncidents.map((incident) => [incident.incidentId, incident]),
  );
  private readonly routePasses = new Map<string, RoutePassRecord>();

  private readonly sponsorDailySpend = new Map<string, number>();
  private readonly gateLinks = new Map<string, Set<string>>();
  private readonly auditLog: WriteAuditRecord[] = [];

  private readonly intel: IntelMessage[] = [];
  private intelSequence = 0;

  private snapshotSequence = 1000;
  private liveEventCursor = 15140;
  private dataSource: DataSource = resolveDataSource();

  private readonly metrics: RuntimeMetrics = {
    startedAt: new Date().toISOString(),
    dataSource: this.dataSource,
    totalRequests: 0,
    writeRequests: 0,
    rateLimitHits: 0,
    idempotencyReplays: 0,
    sponsorAttempts: 0,
    sponsorSuccess: 0,
    sponsorAttemptsDappKit: 0,
    sponsorSuccessDappKit: 0,
    sponsorAttemptsCustom: 0,
    sponsorSuccessCustom: 0,
    routePassAwaitingWallet: 0,
    routePassPendingConfirmation: 0,
    routePassConfirmed: 0,
    routePassFailed: 0,
    distressRaised: 0,
    distressDeduped: 0,
    distressResponded: 0,
    incidentAuditorApprovals: 0,
    incidentInsurerApprovals: 0,
    payoutsExecuted: 0,
    wsBroadcasts: 0,
    wsConnectionsCurrent: 0,
    wsConnectionsPeak: 0,
    grpcEventsIngested: 0,
    endpointP95: {},
  };
  private readonly endpointLatencyBuckets = new Map<string, number[]>();

  constructor() {
    for (const message of mockIntel) {
      this.appendIntel(message);
    }

    for (const [policyId, profile] of this.policies.entries()) {
      this.policyVersions.set(policyId, [
        {
          version: 1,
          changedBy: "bootstrap",
          changedAt: this.metrics.startedAt,
          reason: "initial-policy-seed",
          profile: { ...profile },
        },
      ]);
    }

    this.connectGates("gate-alpha-7", "gate-beta-3");
    this.connectGates("gate-beta-3", "gate-alpha-7");
  }

  listNodes(): NodeRegistration[] {
    return Array.from(this.nodes.values());
  }

  getPolicy(policyId: string): PolicyProfile | null {
    return this.policies.get(policyId) ?? null;
  }

  setPolicy(policyId: string, policy: PolicyProfile, actor = "operator", reason = "direct-update"): PolicyProfile {
    this.policies.set(policyId, policy);
    this.appendPolicyVersion(policyId, actor, reason, policy);
    return policy;
  }

  proposePolicyChange(input: PolicyProposalInput): PolicyProposal {
    const requiresDualApproval = isHighRiskPolicyChange(input.changes);
    const proposal: PolicyProposal = {
      proposalId: `proposal-${randomUUID()}`,
      policyId: input.policyId,
      allianceId: input.allianceId,
      proposer: input.proposer,
      approver: null,
      status: "proposed",
      requiresDualApproval,
      requiredApprovals: requiresDualApproval ? 2 : 1,
      reason: input.reason,
      approverComment: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvals: [],
      changes: input.changes,
    };
    this.policyProposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  approvePolicyProposal(
    proposalId: string,
    approver: string,
    approverComment: string,
    roleBits: number,
  ): PolicyProposal | null {
    const proposal = this.policyProposals.get(proposalId);
    if (!proposal || proposal.status !== "proposed") {
      return null;
    }

    const role = this.resolveApprovalRole(roleBits);
    if (role === null) {
      return null;
    }
    if (proposal.approvals.some((item) => item.approver === approver)) {
      return null;
    }

    proposal.approvals.push({
      approver,
      role,
      comment: approverComment,
      approvedAt: new Date().toISOString(),
    });

    if (!this.isProposalReady(proposal)) {
      proposal.approverComment = approverComment;
      return proposal;
    }

    const current = this.policies.get(proposal.policyId);
    if (!current) {
      return null;
    }

    const nextPolicy: PolicyProfile = {
      ...current,
      ...proposal.changes,
      treatyExemptions: proposal.changes.treatyExemptions ?? current.treatyExemptions,
      redlist: proposal.changes.redlist ?? current.redlist,
      whitelist: proposal.changes.whitelist ?? current.whitelist,
    };

    this.policies.set(proposal.policyId, nextPolicy);
    this.appendPolicyVersion(proposal.policyId, approver, `proposal:${proposalId}`, nextPolicy);

    proposal.status = "approved";
    proposal.approver = approver;
    proposal.approverComment = approverComment;
    proposal.approvedAt = new Date().toISOString();
    return proposal;
  }

  private resolveApprovalRole(roleBits: number): "auditor" | "treaty_admin" | null {
    if ((roleBits & ROLE_AUDITOR) === ROLE_AUDITOR) {
      return "auditor";
    }
    if ((roleBits & ROLE_TREATY_ADMIN) === ROLE_TREATY_ADMIN) {
      return "treaty_admin";
    }
    return null;
  }

  private isProposalReady(proposal: PolicyProposal): boolean {
    if (!proposal.requiresDualApproval) {
      return proposal.approvals.length >= 1;
    }
    const hasAuditor = proposal.approvals.some((item) => item.role === "auditor");
    const hasTreatyAdmin = proposal.approvals.some((item) => item.role === "treaty_admin");
    return hasAuditor && hasTreatyAdmin;
  }

  private connectGates(sourceGateId: string, destinationGateId: string): void {
    const linked = this.gateLinks.get(sourceGateId) ?? new Set<string>();
    linked.add(destinationGateId);
    this.gateLinks.set(sourceGateId, linked);
  }

  isValidGateLink(sourceGateId: string, destinationGateId: string): boolean {
    const linked = this.gateLinks.get(sourceGateId);
    if (!linked) {
      return false;
    }
    return linked.has(destinationGateId);
  }

  rollbackPolicy(policyId: string, targetVersion: number, actor: string, reason: string): PolicyProfile | null {
    const versions = this.policyVersions.get(policyId);
    if (!versions) {
      return null;
    }

    const target = versions.find((item) => item.version === targetVersion);
    if (!target) {
      return null;
    }

    const restored: PolicyProfile = {
      ...target.profile,
      treatyExemptions: [...target.profile.treatyExemptions],
      redlist: [...target.profile.redlist],
      whitelist: [...target.profile.whitelist],
    };
    this.policies.set(policyId, restored);
    this.appendPolicyVersion(policyId, actor, reason, restored);
    return restored;
  }

  listPolicyVersions(policyId: string): PolicyVersionSnapshot[] {
    return [...(this.policyVersions.get(policyId) ?? [])].sort((a, b) => b.version - a.version);
  }

  getLatestPolicyVersion(policyId: string): number | null {
    const versions = this.policyVersions.get(policyId);
    if (!versions || versions.length === 0) {
      return null;
    }
    return versions[versions.length - 1]?.version ?? null;
  }

  listPolicyProposals(allianceId?: string): PolicyProposal[] {
    return Array.from(this.policyProposals.values())
      .filter((proposal) => (allianceId ? proposal.allianceId === allianceId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private appendPolicyVersion(
    policyId: string,
    actor: string,
    reason: string,
    profile: PolicyProfile,
  ): PolicyVersionSnapshot {
    const history = this.policyVersions.get(policyId) ?? [];
    const nextVersion = (history[history.length - 1]?.version ?? 0) + 1;
    const snapshot: PolicyVersionSnapshot = {
      version: nextVersion,
      changedBy: actor,
      changedAt: new Date().toISOString(),
      reason,
      profile: {
        ...profile,
        treatyExemptions: [...profile.treatyExemptions],
        redlist: [...profile.redlist],
        whitelist: [...profile.whitelist],
      },
    };
    const nextHistory = [...history, snapshot].slice(-20);
    this.policyVersions.set(policyId, nextHistory);
    return snapshot;
  }

  nextLiveSnapshot(override?: Partial<LiveSnapshot>): LiveSnapshot {
    const from = this.liveEventCursor;
    const delta = 12 + (this.snapshotSequence % 9);
    const to = from + delta;
    this.liveEventCursor = to + 1;
    this.snapshotSequence += 1;

    return {
      sourceSnapshotId: override?.sourceSnapshotId ?? `snapshot-${this.snapshotSequence}`,
      sourceEventRange: override?.sourceEventRange ?? { from, to },
      dataFreshnessMs: override?.dataFreshnessMs ?? (this.dataSource === "official_live" ? 500 : 1500),
      dataSource: override?.dataSource ?? this.dataSource,
      blockHeight: override?.blockHeight,
    };
  }

  quoteRoute(mode: RouteMode, from?: string, to?: string, snapshotOverride?: Partial<LiveSnapshot>): RouteQuote {
    const snapshot = this.nextLiveSnapshot(snapshotOverride);
    const base = buildRouteQuote(mode);
    return {
      ...base,
      from: from ?? base.from,
      to: to ?? base.to,
      sourceSnapshotId: snapshot.sourceSnapshotId,
      sourceEventRange: snapshot.sourceEventRange,
      dataFreshnessMs: snapshot.dataFreshnessMs,
      dataSource: snapshot.dataSource,
    };
  }

  issueRoutePass(input: RoutePassIssueInput): RoutePassRecord {
    const pass: RoutePassRecord = {
      routePassId: input.routePassId,
      allianceId: input.allianceId,
      characterId: input.characterId,
      actorAddress: input.actorAddress,
      sourceGateId: input.sourceGateId,
      destinationGateId: input.destinationGateId,
      routeFingerprint: input.routeFingerprint,
      sponsorProvider: input.sponsorProvider,
      quotedCost: input.quotedCost,
      quotedRisk: input.quotedRisk,
      sourceSnapshotId: input.sourceSnapshotId,
      permitExpiresAtMs: input.permitExpiresAtMs,
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      status: input.sponsorProvider === "dapp-kit" ? "await_wallet_signature" : "pending_chain_confirmation",
      consumed: false,
      submittedPermitDigest: null,
      submittedAt: null,
      linkedPermitDigest: null,
      confirmedAt: null,
      confirmationLastCheckedAt: null,
      confirmationError: null,
    };
    this.routePasses.set(pass.routePassId, pass);
    if (pass.status === "await_wallet_signature") {
      this.metrics.routePassAwaitingWallet += 1;
    } else {
      this.metrics.routePassPendingConfirmation += 1;
    }
    return pass;
  }

  getRoutePass(routePassId: string): RoutePassRecord | null {
    return this.routePasses.get(routePassId) ?? null;
  }

  submitRoutePassPermitDigest(routePassId: string, permitDigest: string): RoutePassRecord | null {
    const pass = this.routePasses.get(routePassId);
    if (!pass) {
      return null;
    }
    if (pass.status === "await_wallet_signature") {
      this.metrics.routePassAwaitingWallet = Math.max(0, this.metrics.routePassAwaitingWallet - 1);
      this.metrics.routePassPendingConfirmation += 1;
    }
    pass.status = "pending_chain_confirmation";
    pass.submittedPermitDigest = permitDigest;
    pass.submittedAt = new Date().toISOString();
    pass.confirmationLastCheckedAt = pass.submittedAt;
    pass.confirmationError = null;
    return pass;
  }

  markRoutePassConsumed(routePassId: string, permitDigest: string): RoutePassRecord | null {
    const pass = this.routePasses.get(routePassId);
    if (!pass) {
      return null;
    }
    if (!pass.consumed) {
      if (pass.status === "await_wallet_signature") {
        this.metrics.routePassAwaitingWallet = Math.max(0, this.metrics.routePassAwaitingWallet - 1);
      }
      if (pass.status === "pending_chain_confirmation") {
        this.metrics.routePassPendingConfirmation = Math.max(0, this.metrics.routePassPendingConfirmation - 1);
      }
      this.metrics.routePassConfirmed += 1;
    }
    pass.status = "confirmed";
    pass.consumed = true;
    pass.submittedPermitDigest = pass.submittedPermitDigest ?? permitDigest;
    pass.linkedPermitDigest = permitDigest;
    pass.confirmedAt = new Date().toISOString();
    pass.confirmationLastCheckedAt = pass.confirmedAt;
    pass.confirmationError = null;
    return pass;
  }

  failRoutePassConfirmation(routePassId: string, error: string): RoutePassRecord | null {
    const pass = this.routePasses.get(routePassId);
    if (!pass) {
      return null;
    }
    if (pass.status === "await_wallet_signature") {
      this.metrics.routePassAwaitingWallet = Math.max(0, this.metrics.routePassAwaitingWallet - 1);
    }
    if (pass.status === "pending_chain_confirmation") {
      this.metrics.routePassPendingConfirmation = Math.max(0, this.metrics.routePassPendingConfirmation - 1);
    }
    if (pass.status !== "failed") {
      this.metrics.routePassFailed += 1;
    }
    pass.status = "failed";
    pass.confirmationError = error;
    pass.confirmationLastCheckedAt = new Date().toISOString();
    return pass;
  }

  touchRoutePassConfirmation(routePassId: string): RoutePassRecord | null {
    const pass = this.routePasses.get(routePassId);
    if (!pass) {
      return null;
    }
    pass.confirmationLastCheckedAt = new Date().toISOString();
    return pass;
  }

  listPendingRoutePasses(): RoutePassRecord[] {
    return Array.from(this.routePasses.values()).filter(
      (pass) => pass.status === "pending_chain_confirmation" && !!pass.submittedPermitDigest && !pass.consumed,
    );
  }

  findRoutePassBySubmittedDigest(permitDigest: string): RoutePassRecord | null {
    for (const pass of this.routePasses.values()) {
      if (pass.submittedPermitDigest === permitDigest) {
        return pass;
      }
    }
    return null;
  }

  createOrUpdateDistress(
    input: DistressInput,
    dedupeWindowMs = 30_000,
    snapshotOverride?: Partial<LiveSnapshot>,
  ): {
    beacon: DistressBeacon;
    deduped: boolean;
  } {
    const now = new Date().toISOString();
    const recent = this.findRecentOpenDistress(
      input.allianceId,
      input.characterId,
      input.systemId,
      dedupeWindowMs,
    );

    const snapshot = this.nextLiveSnapshot(snapshotOverride);

    if (recent) {
      recent.threatLevel = input.threatLevel;
      recent.bondAmount = input.bondAmount;
      recent.openedAt = now;
      recent.locationProofHash = input.locationProofHash;
      recent.sourceSnapshotId = snapshot.sourceSnapshotId;
      recent.chainDigest = input.chainDigest;
      recent.dataSource = snapshot.dataSource;
      this.metrics.distressDeduped += 1;
      return { beacon: recent, deduped: true };
    }

    const beacon: DistressBeacon = {
      beaconId: input.beaconId,
      allianceId: input.allianceId,
      characterId: input.characterId,
      systemId: input.systemId,
      threatLevel: input.threatLevel,
      bondAmount: input.bondAmount,
      status: "open",
      openedAt: now,
      responders: [],
      locationProofHash: input.locationProofHash,
      sourceSnapshotId: snapshot.sourceSnapshotId,
      chainDigest: input.chainDigest,
      dataSource: snapshot.dataSource,
    };

    this.beacons.set(beacon.beaconId, beacon);
    this.metrics.distressRaised += 1;
    return { beacon, deduped: false };
  }

  acceptResponder(input: ResponderAcceptInput): DistressBeacon | null {
    const beacon = this.beacons.get(input.beaconId);
    if (!beacon) {
      return null;
    }
    if (beacon.status !== "open" && beacon.status !== "claimed") {
      return null;
    }
    if (beacon.responders.some((item) => item.responderId === input.responderId)) {
      return null;
    }

    beacon.responders.push({
      responderId: input.responderId,
      bondAmount: input.bondAmount,
      acceptedAt: new Date().toISOString(),
    });
    beacon.status = "claimed";
    this.metrics.distressResponded += 1;
    return beacon;
  }

  private findRecentOpenDistress(
    allianceId: string,
    characterId: string,
    systemId: string,
    dedupeWindowMs: number,
  ): DistressBeacon | null {
    const now = Date.now();
    for (const beacon of this.beacons.values()) {
      if (beacon.status !== "open") {
        continue;
      }
      if (beacon.allianceId !== allianceId || beacon.characterId !== characterId || beacon.systemId !== systemId) {
        continue;
      }
      const age = now - parseIsoMs(beacon.openedAt);
      if (age <= dedupeWindowMs) {
        return beacon;
      }
    }
    return null;
  }

  listBeacons(): DistressBeacon[] {
    return Array.from(this.beacons.values()).sort((a, b) =>
      b.openedAt.localeCompare(a.openedAt),
    );
  }

  upsertIncident(
    incident: Omit<
      IncidentCase,
      | "sourceSnapshotId"
      | "sourceEventRange"
      | "chainDigest"
      | "beaconId"
      | "status"
      | "operatorComment"
      | "auditorApproved"
      | "auditorAddress"
      | "auditorComment"
      | "insurerApproved"
      | "insurerAddress"
      | "insurerComment"
      | "payoutTotal"
      | "payoutExecutedAt"
      | "resolvedAtMs"
      | "evidenceHashes"
      | "chainEventSeq"
    > & {
      sourceSnapshotId?: string;
      sourceEventRange?: { from: number; to: number };
      chainDigest?: string | null;
      beaconId?: string | null;
      status?: IncidentStatus;
      operatorComment?: string | null;
      auditorApproved?: boolean;
      auditorAddress?: string | null;
      auditorComment?: string | null;
      insurerApproved?: boolean;
      insurerAddress?: string | null;
      insurerComment?: string | null;
      payoutTotal?: number;
      payoutExecutedAt?: string | null;
      resolvedAtMs?: number | null;
      evidenceHashes?: string[];
      chainEventSeq?: string | null;
    },
    snapshotOverride?: Partial<LiveSnapshot>,
  ): IncidentCase {
    const snapshot = this.nextLiveSnapshot(snapshotOverride);
    const existing = this.incidents.get(incident.incidentId);
    const generatedEvidence =
      (incident.evidenceHashes && incident.evidenceHashes.length > 0)
        ? incident.evidenceHashes
        : Array.from({ length: incident.evidenceCount ?? 0 }, (_unused, index) => `${incident.incidentId}-evidence-${index + 1}`);
    const mergedEvidenceHashes = Array.from(
      new Set([...(existing?.evidenceHashes ?? []), ...generatedEvidence]),
    );
    const normalized: IncidentCase = {
      ...incident,
      beaconId: incident.beaconId ?? existing?.beaconId ?? null,
      sourceSnapshotId: incident.sourceSnapshotId ?? snapshot.sourceSnapshotId,
      sourceEventRange: incident.sourceEventRange ?? snapshot.sourceEventRange,
      chainDigest: incident.chainDigest ?? null,
      status: incident.status ?? existing?.status ?? "evidence_attached",
      operatorComment: incident.operatorComment ?? existing?.operatorComment ?? null,
      auditorApproved: incident.auditorApproved ?? existing?.auditorApproved ?? false,
      auditorAddress: incident.auditorAddress ?? existing?.auditorAddress ?? null,
      auditorComment: incident.auditorComment ?? existing?.auditorComment ?? null,
      insurerApproved: incident.insurerApproved ?? existing?.insurerApproved ?? false,
      insurerAddress: incident.insurerAddress ?? existing?.insurerAddress ?? null,
      insurerComment: incident.insurerComment ?? existing?.insurerComment ?? null,
      payoutTotal: incident.payoutTotal ?? existing?.payoutTotal ?? 0,
      payoutExecutedAt: incident.payoutExecutedAt ?? existing?.payoutExecutedAt ?? null,
      resolvedAtMs: incident.resolvedAtMs ?? existing?.resolvedAtMs ?? null,
      evidenceHashes: mergedEvidenceHashes,
      evidenceCount: mergedEvidenceHashes.length,
      chainEventSeq: incident.chainEventSeq ?? existing?.chainEventSeq ?? null,
    };
    this.incidents.set(normalized.incidentId, normalized);
    return normalized;
  }

  getIncident(incidentId: string): IncidentCase | null {
    return this.incidents.get(incidentId) ?? null;
  }

  listIncidents(): IncidentCase[] {
    return Array.from(this.incidents.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  findIncidentByKillmailRef(killmailRef: string): IncidentCase | null {
    for (const incident of this.incidents.values()) {
      if (incident.killmailRef === killmailRef) {
        return incident;
      }
    }
    return null;
  }

  auditorApproveIncident(incidentId: string, auditor: string, comment: string): IncidentCase | null {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.status === "rejected" || incident.status === "payout_executed") {
      return null;
    }

    incident.auditorApproved = true;
    incident.auditorAddress = auditor;
    incident.auditorComment = comment;
    incident.status = "auditor_approved";
    incident.updatedAt = new Date().toISOString();
    this.metrics.incidentAuditorApprovals += 1;
    return incident;
  }

  insurerApproveAndExecutePayout(
    incidentId: string,
    insurer: string,
    comment: string,
    payoutPlan: PayoutItem[],
  ): IncidentCase | null {
    const incident = this.incidents.get(incidentId);
    if (!incident || !incident.auditorApproved || incident.status === "rejected" || incident.status === "payout_executed") {
      return null;
    }

    const payoutTotal = payoutPlan.reduce((sum, item) => sum + item.amount, 0);
    incident.insurerApproved = true;
    incident.insurerAddress = insurer;
    incident.insurerComment = comment;
    incident.payoutTotal = payoutTotal;
    incident.payoutExecutedAt = new Date().toISOString();
    incident.resolvedAtMs = Date.now();
    incident.verdict = "confirmed";
    incident.status = "payout_executed";
    incident.updatedAt = incident.payoutExecutedAt;
    this.metrics.incidentInsurerApprovals += 1;
    this.metrics.payoutsExecuted += 1;
    return incident;
  }

  rejectIncident(incidentId: string): IncidentCase | null {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      return null;
    }
    incident.verdict = "rejected";
    incident.status = "rejected";
    incident.resolvedAtMs = Date.now();
    incident.updatedAt = new Date().toISOString();
    return incident;
  }

  appendIntel(
    message: Omit<IntelMessage, "sequence" | "dataSource"> &
      Partial<Pick<IntelMessage, "sequence" | "dataSource">>,
  ): IntelMessage {
    const nextMessage: IntelMessage = {
      ...message,
      sequence: message.sequence ?? ++this.intelSequence,
      dataSource: message.dataSource ?? this.dataSource,
    };

    if (nextMessage.sequence > this.intelSequence) {
      this.intelSequence = nextMessage.sequence;
    }

    this.intel.unshift(nextMessage);
    if (this.intel.length > 400) {
      this.intel.pop();
    }

    return nextMessage;
  }

  listIntel(sinceSequence?: number): IntelMessage[] {
    if (sinceSequence === undefined) {
      return [...this.intel];
    }
    return this.intel.filter((message) => message.sequence > sinceSequence);
  }

  getLatestIntelSequence(): number {
    return this.intelSequence;
  }

  reserveSponsorBudget(allianceId: string, amount: number, dailyLimit: number): SponsorReservation {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${allianceId}:${day}`;
    const spent = this.sponsorDailySpend.get(key) ?? 0;

    if (spent + amount > dailyLimit) {
      return {
        allowed: false,
        remaining: Math.max(0, dailyLimit - spent),
      };
    }

    const nextSpent = spent + amount;
    this.sponsorDailySpend.set(key, nextSpent);

    return {
      allowed: true,
      remaining: Math.max(0, dailyLimit - nextSpent),
    };
  }

  appendAudit(record: WriteAuditRecord): void {
    this.auditLog.unshift(record);
    if (this.auditLog.length > 2000) {
      this.auditLog.pop();
    }
  }

  listAudit(limit = 100): WriteAuditRecord[] {
    return this.auditLog.slice(0, limit);
  }

  setDataSource(dataSource: DataSource): void {
    this.dataSource = dataSource;
    this.metrics.dataSource = dataSource;
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  newDigest(): string {
    return `0x${randomUUID().replaceAll("-", "")}`;
  }

  hashLocationProof(locationProof: string): string {
    return createHash("sha256").update(locationProof).digest("hex");
  }

  recordRequest(isWrite = false): void {
    this.metrics.totalRequests += 1;
    if (isWrite) {
      this.metrics.writeRequests += 1;
    }
  }

  recordRateLimitHit(): void {
    this.metrics.rateLimitHits += 1;
  }

  recordIdempotencyReplay(): void {
    this.metrics.idempotencyReplays += 1;
  }

  recordSponsorAttempt(provider: "dapp-kit" | "custom", success: boolean): void {
    this.metrics.sponsorAttempts += 1;
    if (success) {
      this.metrics.sponsorSuccess += 1;
    }
    if (provider === "dapp-kit") {
      this.metrics.sponsorAttemptsDappKit += 1;
      if (success) {
        this.metrics.sponsorSuccessDappKit += 1;
      }
      return;
    }
    this.metrics.sponsorAttemptsCustom += 1;
    if (success) {
      this.metrics.sponsorSuccessCustom += 1;
    }
  }

  recordWsBroadcast(): void {
    this.metrics.wsBroadcasts += 1;
  }

  recordWsConnectionOpen(): void {
    this.metrics.wsConnectionsCurrent += 1;
    if (this.metrics.wsConnectionsCurrent > this.metrics.wsConnectionsPeak) {
      this.metrics.wsConnectionsPeak = this.metrics.wsConnectionsCurrent;
    }
  }

  recordWsConnectionClose(): void {
    this.metrics.wsConnectionsCurrent = Math.max(0, this.metrics.wsConnectionsCurrent - 1);
  }

  recordGrpcEventIngested(): void {
    this.metrics.grpcEventsIngested += 1;
  }

  recordRequestLatency(endpoint: string, durationMs: number): void {
    const normalized = endpoint.replace(/\/[0-9a-fA-F-]{6,}/g, "/:id");
    const current = this.endpointLatencyBuckets.get(normalized) ?? [];
    current.push(durationMs);
    const trimmed = current.slice(-500);
    this.endpointLatencyBuckets.set(normalized, trimmed);
    this.metrics.endpointP95[normalized] = this.percentile(trimmed, 95);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return Number(sorted[index]?.toFixed(2) ?? 0);
  }

  getMetrics(): RuntimeMetrics {
    return {
      ...this.metrics,
      endpointP95: {
        ...this.metrics.endpointP95,
      },
    };
  }
}

export const store = new AegisStore();
