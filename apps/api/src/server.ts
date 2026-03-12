import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { URL } from "node:url";

import cors from "cors";
import express, { type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import type { IntelMessage, SponsorProvider } from "@aegis-mesh/shared";

import { GrpcEventStream, type GrpcStreamEvent } from "./grpc-stream";
import { eventIndexer } from "./indexer";
import { liveUniverse } from "./live-universe";
import { verifyAdminAcl, verifyOwnerCap } from "./official-auth";
import {
  auditorApproveSchema,
  distressSchema,
  incidentAttachSchema,
  insurerApproveSchema,
  policyApprovalSchema,
  policyProposalSchema,
  policyRollbackSchema,
  policySchema,
  responderAcceptSchema,
  routePassConsumeSchema,
  routeQuoteSchema,
  sponsorRouteSchema,
  writeRequestHeadersSchema,
} from "./schemas";
import {
  buildApiError,
  FailureGuard,
  IdempotencyStore,
  SlidingWindowRateLimiter,
  TokenBucketRateLimiter,
  toRequestHash,
} from "./security";
import { store, type WriteAuditRecord } from "./store";

const ROLE_OPERATOR = 1 << 0;
const ROLE_AUDITOR = 1 << 1;
const ROLE_INSURER = 1 << 2;
const ROLE_TREATY_ADMIN = 1 << 3;

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => {
  const isWrite = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
  store.recordRequest(isWrite);
  const start = Date.now();
  _res.on("finish", () => {
    store.recordRequestLatency(req.path, Date.now() - start);
  });
  next();
});

const rateLimiter = new SlidingWindowRateLimiter();
const tokenBucketLimiter = new TokenBucketRateLimiter();
const idempotencyStore = new IdempotencyStore();
const sponsorFailureGuard = new FailureGuard();

const sponsorBudgetPerAlliance = Number(process.env.DAILY_SPONSOR_BUDGET_PER_ALLIANCE ?? "1000");
const maxClockSkewMs = Number(process.env.REQUEST_MAX_SKEW_MS ?? "300000");
const minDistressBond = Number(process.env.MIN_DISTRESS_BOND ?? "0");
const dappKitSponsorEnabled = process.env.DAPP_KIT_SPONSOR_ENABLED !== "false";
const customSponsorEnabled = process.env.CUSTOM_SPONSOR_ENABLED !== "false";
const dappKitSimulateExecution = process.env.DAPP_KIT_SIMULATE_EXECUTION === "true";
const worldBridgePackageId = process.env.AEGIS_WORLD_BRIDGE_PACKAGE_ID ?? null;
const worldServerRegistryId = process.env.WORLD_SERVER_REGISTRY_ID ?? null;
const worldClockObjectId = process.env.WORLD_CLOCK_OBJECT_ID ?? "0x6";

const sponsorCharacterLimitPerMinute = 10;
const sponsorAllianceLimitPerMinute = 60;
const distressCharacterLimitPerMinute = 3;
const distressAllianceLimitPerHour = 20;

const grpcStream = new GrpcEventStream((event: GrpcStreamEvent) => {
  store.recordGrpcEventIngested();
  const intel = store.appendIntel({
    id: `grpc-${event.eventSeq}`,
    kind: event.channel.includes("policy")
      ? "policy"
      : event.channel.includes("claims")
        ? "claims"
        : "threat",
    channel: event.channel === "intel.policy" || event.channel === "intel.claims" ? event.channel : "intel.threat",
    headline: event.headline,
    summary: event.summary,
    createdAt: event.createdAt,
  });
  broadcastIntel(intel);
});

interface WriteRequestContext {
  requestId: string;
  endpoint: string;
  actor: string;
  allianceId: string;
  roleBits: number;
  idempotencyKey: string;
  idempotencyStoreKey: string;
}

interface WriteResult {
  statusCode: number;
  body: unknown;
  sourceSnapshotId: string;
  txDigest?: string | null;
}

function hasRole(roleBits: number, role: number): boolean {
  return (roleBits & role) === role;
}

function getHeaderValue(req: Request, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function getRequestIp(req: Request): string {
  const forwarded = getHeaderValue(req, "x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip || "unknown";
}

function parseRoleBits(req: Request): number {
  const raw = getHeaderValue(req, "x-role-bits");
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function parseWriteContext(
  req: Request,
  res: Response,
  endpoint: string,
  allianceIdFromBody: string,
): WriteRequestContext | null {
  const requestId = randomUUID();

  const headerInput = {
    "idempotency-key": getHeaderValue(req, "idempotency-key"),
    "x-request-timestamp": getHeaderValue(req, "x-request-timestamp"),
    "x-alliance-id": getHeaderValue(req, "x-alliance-id"),
    "x-actor-address": getHeaderValue(req, "x-actor-address"),
    "x-role-bits": getHeaderValue(req, "x-role-bits"),
  };

  const parsedHeaders = writeRequestHeadersSchema.safeParse(headerInput);
  if (!parsedHeaders.success) {
    res.status(400).json(buildApiError("UNAUTHORIZED", "Missing or invalid write headers", requestId));
    return null;
  }

  const now = Date.now();
  const drift = Math.abs(now - parsedHeaders.data["x-request-timestamp"]);
  if (drift > maxClockSkewMs) {
    res.status(401).json(buildApiError("UNAUTHORIZED", "Request timestamp is outside allowed skew", requestId));
    return null;
  }

  const headerAllianceId = parsedHeaders.data["x-alliance-id"];
  if (headerAllianceId && allianceIdFromBody && headerAllianceId !== allianceIdFromBody) {
    res.status(400).json(buildApiError("UNAUTHORIZED", "Alliance header does not match payload allianceId", requestId));
    return null;
  }

  const actor = parsedHeaders.data["x-actor-address"] ?? "unknown-actor";
  const allianceId = headerAllianceId ?? allianceIdFromBody;
  const roleBits = parseRoleBits(req);
  const idempotencyKey = parsedHeaders.data["idempotency-key"];
  const idempotencyStoreKey = `${actor}:${endpoint}:${idempotencyKey}`;

  return {
    requestId,
    endpoint,
    actor,
    allianceId,
    roleBits,
    idempotencyKey,
    idempotencyStoreKey,
  };
}

function ensureIdempotency(
  req: Request,
  res: Response,
  context: WriteRequestContext,
): "continue" | "handled" {
  const requestHash = toRequestHash({
    method: req.method,
    path: req.path,
    body: req.body,
    query: req.query,
  });

  const idempotencyDecision = idempotencyStore.begin(context.idempotencyStoreKey, requestHash);
  if (idempotencyDecision.status === "replay") {
    store.recordIdempotencyReplay();
    res.status(idempotencyDecision.statusCode).json(idempotencyDecision.responseBody);
    return "handled";
  }

  if (idempotencyDecision.status === "conflict") {
    res.status(409).json(
      buildApiError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used with another payload or is currently in-flight",
        context.requestId,
      ),
    );
    return "handled";
  }

  return "continue";
}

function finalizeWrite(res: Response, context: WriteRequestContext, result: WriteResult): void {
  idempotencyStore.complete(context.idempotencyStoreKey, result.statusCode, result.body);

  const auditRecord: WriteAuditRecord = {
    requestId: context.requestId,
    endpoint: context.endpoint,
    actor: context.actor,
    roleBits: context.roleBits,
    allianceId: context.allianceId,
    idempotencyKey: context.idempotencyKey,
    sourceSnapshotId: result.sourceSnapshotId,
    result: result.statusCode < 400 ? "success" : "failed",
    txDigest: result.txDigest ?? null,
    createdAt: new Date().toISOString(),
  };
  store.appendAudit(auditRecord);

  res.status(result.statusCode).json(result.body);
}

function isStaleLiveSnapshot(snapshot: Awaited<ReturnType<typeof getLiveSnapshot>>): boolean {
  return snapshot.dataSource === "stale" || snapshot.dataFreshnessMs > 5_000;
}

function isOfficialMode(): boolean {
  return liveUniverse.getMode() === "official_live";
}

function failWrite(
  res: Response,
  context: WriteRequestContext,
  errorCode: string,
  message: string,
  statusCode: number,
): void {
  const body = buildApiError(errorCode, message, context.requestId);
  finalizeWrite(res, context, {
    statusCode,
    body,
    sourceSnapshotId: "snapshot-error",
  });
}

function enforceRateLimit(
  res: Response,
  context: WriteRequestContext,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const slidingWindow = rateLimiter.consume(key, limit, windowMs);
  const refillPerSecond = limit / Math.max(1, windowMs / 1000);
  const tokenBucket = tokenBucketLimiter.consume(key, limit, refillPerSecond);
  if (slidingWindow.allowed && tokenBucket.allowed) {
    return true;
  }
  const retryAfterMs = Math.max(slidingWindow.retryAfterMs, tokenBucket.retryAfterMs);

  store.recordRateLimitHit();
  const body = buildApiError(
    "RATE_LIMITED",
    "Request rate exceeded for this operation",
    context.requestId,
    retryAfterMs,
  );
  finalizeWrite(res, context, {
    statusCode: 429,
    sourceSnapshotId: "snapshot-rate-limit",
    body,
  });

  return false;
}

async function getLiveSnapshot() {
  const snapshot = await liveUniverse.getSnapshot();
  store.setDataSource(snapshot.dataSource);
  return snapshot;
}

app.get("/health", async (_req, res) => {
  const live = liveUniverse.getStatus();
  res.json({
    ok: true,
    service: "aegis-mesh-api",
    dataSource: store.getDataSource(),
    liveHealthy: live.rpcHealthy,
    graphqlHealthy: live.graphqlHealthy,
    grpcHealthy: live.grpcHealthy,
  });
});

app.get("/live/status", (_req, res) => {
  const latest = store.getLatestIntelSequence();
  const liveStatus = liveUniverse.getStatus();
  const hasOfficialBinding =
    liveUniverse.getMode() === "official_live" &&
    liveStatus.rpcHealthy &&
    liveStatus.graphqlHealthy;
  res.json({
    configuredMode: liveUniverse.getMode(),
    dataSource: store.getDataSource(),
    latestIntelSequence: latest,
    hasOfficialBinding,
    liveStatus,
    grpcStream: grpcStream.getStatus(),
  });
});

app.get("/indexer/status", (_req, res) => {
  res.json({
    indexer: eventIndexer.getStatus(),
  });
});

app.get("/live/sources", (_req, res) => {
  const liveStatus = liveUniverse.getStatus();
  const indexerStatus = eventIndexer.getStatus();
  const grpcStatus = grpcStream.getStatus();
  res.json({
    dataSource: store.getDataSource(),
    sources: {
      rpc: {
        url: liveStatus.rpcUrl,
        healthy: liveStatus.rpcHealthy,
      },
      graphql: {
        url: liveStatus.graphqlUrl,
        healthy: liveStatus.graphqlHealthy,
      },
      grpc: {
        url: liveStatus.grpcUrl,
        healthy: liveStatus.grpcHealthy,
        lastEventSeq: liveStatus.lastGrpcEventSeq,
        streamEnabled: grpcStatus.enabled,
        streamRunning: grpcStatus.running,
        streamLastError: grpcStatus.lastError,
        streamTotalEvents: grpcStatus.totalEvents,
      },
      eventIndexer: {
        enabled: indexerStatus.enabled,
        running: indexerStatus.running,
        totalEvents: indexerStatus.totalEvents,
        lastCursor: indexerStatus.lastCursor,
        lastError: indexerStatus.lastError,
      },
    },
  });
});

app.get("/metrics", (_req, res) => {
  res.json({
    metrics: store.getMetrics(),
  });
});

app.get("/nodes", (_req, res) => {
  const nodes = store.listNodes().map((node) => ({
    ...node,
    policy: store.getPolicy(node.policyId),
  }));
  res.json({ nodes });
});

app.get("/route/quote", async (req, res) => {
  const parsed = routeQuoteSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  if (isOfficialMode() && !parsed.data.sourceSnapshotId) {
    return res.status(400).json(
      buildApiError(
        "SOURCE_SNAPSHOT_REQUIRED",
        "sourceSnapshotId is required for official_live route quote requests",
      ),
    );
  }

  const liveSnapshot = await getLiveSnapshot();
  const quote = store.quoteRoute(
    parsed.data.mode,
    parsed.data.from,
    parsed.data.to,
    {
      ...liveSnapshot,
      sourceSnapshotId: parsed.data.sourceSnapshotId ?? liveSnapshot.sourceSnapshotId,
    },
  );
  return res.json(quote);
});

app.post("/sponsor/route", async (req, res) => {
  const parsed = sponsorRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/sponsor/route", parsed.data.allianceId);
  if (!context) {
    return;
  }

  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }

  const adminAclCheck = await verifyAdminAcl(req, liveUniverse.getMode());
  if (!adminAclCheck.ok) {
    failWrite(res, context, adminAclCheck.errorCode, adminAclCheck.message, 403);
    return;
  }
  if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for sponsor route", 403);
    return;
  }

  if (isOfficialMode() && !parsed.data.locationProof) {
    failWrite(res, context, "LOCATION_PROOF_REQUIRED", "locationProof is required in official_live mode", 400);
    return;
  }

  if (!store.isValidGateLink(parsed.data.sourceGateId, parsed.data.destinationGateId)) {
    failWrite(res, context, "INVALID_ROUTE_LINKING", "Gate link is invalid or not authorized", 400);
    return;
  }

  if (parsed.data.sponsorProvider === "dapp-kit" && !dappKitSponsorEnabled) {
    failWrite(res, context, "SPONSORED_TX_PROVIDER_UNAVAILABLE", "dapp-kit sponsor is currently unavailable", 503);
    return;
  }
  if (parsed.data.sponsorProvider === "custom" && !customSponsorEnabled) {
    failWrite(res, context, "SPONSORED_TX_PROVIDER_UNAVAILABLE", "custom sponsor service is currently unavailable", 503);
    return;
  }

  const ip = getRequestIp(req);
  const guardKey = `${context.allianceId}:${parsed.data.characterId}`;
  const cooldownMs = sponsorFailureGuard.isCooling(guardKey);
  if (cooldownMs > 0) {
    finalizeWrite(res, context, {
      statusCode: 429,
      sourceSnapshotId: "snapshot-guard",
      body: buildApiError(
        "SPONSOR_GUARD_TRIGGERED",
        "Sponsor flow is temporarily throttled due to repeated failures",
        context.requestId,
        cooldownMs,
      ),
    });
    return;
  }

  if (
    !enforceRateLimit(
      res,
      context,
      `sponsor:character:${ip}:${context.actor}:${context.allianceId}:${parsed.data.characterId}`,
      sponsorCharacterLimitPerMinute,
      60_000,
    )
  ) {
    sponsorFailureGuard.recordFailure(guardKey);
    store.recordSponsorAttempt(parsed.data.sponsorProvider, false);
    return;
  }

  if (
    !enforceRateLimit(
      res,
      context,
      `sponsor:alliance:${ip}:${context.allianceId}`,
      sponsorAllianceLimitPerMinute,
      60_000,
    )
  ) {
    sponsorFailureGuard.recordFailure(guardKey);
    store.recordSponsorAttempt(parsed.data.sponsorProvider, false);
    return;
  }

  const liveSnapshot = await getLiveSnapshot();
  if (isStaleLiveSnapshot(liveSnapshot)) {
    sponsorFailureGuard.recordFailure(guardKey);
    store.recordSponsorAttempt(parsed.data.sponsorProvider, false);
    finalizeWrite(res, context, {
      statusCode: 503,
      sourceSnapshotId: liveSnapshot.sourceSnapshotId,
      body: buildApiError(
        "UPSTREAM_DATA_STALE",
        "Live universe snapshot is stale; sponsor route is temporarily disabled",
        context.requestId,
      ),
    });
    return;
  }
  const routeQuote = store.quoteRoute(parsed.data.mode, parsed.data.from, parsed.data.to, liveSnapshot);

  const budget = store.reserveSponsorBudget(context.allianceId, routeQuote.estimatedCost, sponsorBudgetPerAlliance);
  if (!budget.allowed) {
    sponsorFailureGuard.recordFailure(guardKey);
    store.recordSponsorAttempt(parsed.data.sponsorProvider, false);
    finalizeWrite(res, context, {
      statusCode: 429,
      sourceSnapshotId: routeQuote.sourceSnapshotId,
      body: buildApiError(
        "SPONSOR_BUDGET_EXCEEDED",
        "Daily sponsor budget exhausted for this alliance",
        context.requestId,
      ),
    });
    return;
  }

  const sponsorProvider: SponsorProvider = parsed.data.sponsorProvider;
  const routePassId = parsed.data.passId ?? `route-pass-${randomUUID()}`;
  const sponsorDigest = sponsorProvider === "custom"
    ? store.newDigest()
    : (dappKitSimulateExecution ? store.newDigest() : null);
  const routeFingerprint = `${parsed.data.from}->${parsed.data.to}:${parsed.data.mode}`;
  const permitExpiresAtMs = Date.now() + 5 * 60 * 1000;
  const routePass = store.issueRoutePass({
    routePassId,
    allianceId: parsed.data.allianceId,
    characterId: parsed.data.characterId,
    actorAddress: context.actor,
    sourceGateId: parsed.data.sourceGateId,
    destinationGateId: parsed.data.destinationGateId,
    routeFingerprint,
    sponsorProvider,
    quotedCost: routeQuote.estimatedCost,
    quotedRisk: routeQuote.estimatedRisk,
    sourceSnapshotId: routeQuote.sourceSnapshotId,
    permitExpiresAtMs,
    expiresAt: new Date(permitExpiresAtMs).toISOString(),
  });
  const submittedRoutePass = sponsorDigest
    ? store.submitRoutePassPermitDigest(routePassId, sponsorDigest) ?? routePass
    : routePass;
  const dappKitPayload = sponsorProvider === "dapp-kit"
    ? {
        method: "signAndExecuteBridgeTransaction",
        configured: Boolean(worldBridgePackageId && worldServerRegistryId),
        target: worldBridgePackageId
          ? `${worldBridgePackageId}::aegis_world_bridge::issue_jump_permit_with_location_proof`
          : null,
        packageId: worldBridgePackageId,
        serverRegistryId: worldServerRegistryId,
        clockObjectId: worldClockObjectId,
        sourceGateId: parsed.data.sourceGateId,
        destinationGateId: parsed.data.destinationGateId,
        characterObjectId: parsed.data.characterId,
        locationProof: parsed.data.locationProof ?? null,
        expiresAtMs: permitExpiresAtMs,
        routePassId,
        sourceSnapshotId: routeQuote.sourceSnapshotId,
      }
    : null;
  const body = {
    routePassId,
    status: submittedRoutePass.status,
    sponsorProvider,
    sponsorDigest,
    requiresClientExecution: sponsorProvider === "dapp-kit" && sponsorDigest === null,
    dappKitPayload,
    quote: routeQuote,
    routePass: submittedRoutePass,
    remainingSponsorBudget: budget.remaining,
    requestId: context.requestId,
  };

  sponsorFailureGuard.recordSuccess(guardKey);
  store.recordSponsorAttempt(parsed.data.sponsorProvider, true);

  const intel = store.appendIntel({
    id: `intel-${randomUUID()}`,
    kind: "threat",
    channel: "intel.threat",
    headline: `Route sponsorship issued for ${parsed.data.characterId}`,
    summary: `Mode ${parsed.data.mode} from ${parsed.data.from} to ${parsed.data.to} via ${sponsorProvider}.`,
    createdAt: new Date().toISOString(),
  });
  broadcastIntel(intel);

  finalizeWrite(res, context, {
    statusCode: 201,
    body,
    sourceSnapshotId: routeQuote.sourceSnapshotId,
    txDigest: sponsorDigest,
  });
});

app.get("/route/pass/:id", (req, res) => {
  const pass = store.getRoutePass(req.params.id);
  if (!pass) {
    return res.status(404).json(buildApiError("ROUTE_PASS_NOT_FOUND", "Route pass not found"));
  }
  return res.json(pass);
});

app.post("/route/pass/consume", (req, res) => {
  const parsed = routePassConsumeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/route/pass/consume", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for route pass consume", 403);
    return;
  }

  const existingPass = store.getRoutePass(parsed.data.routePassId);
  if (!existingPass) {
    failWrite(res, context, "ROUTE_PASS_NOT_FOUND", "Route pass not found", 404);
    return;
  }
  if (existingPass.consumed) {
    failWrite(res, context, "ROUTE_PASS_ALREADY_CONSUMED", "Route pass is already consumed", 409);
    return;
  }

  const pass = store.submitRoutePassPermitDigest(parsed.data.routePassId, parsed.data.permitDigest);
  if (!pass) {
    failWrite(res, context, "ROUTE_PASS_NOT_FOUND", "Route pass not found", 404);
    return;
  }

  finalizeWrite(res, context, {
    statusCode: 202,
    sourceSnapshotId: pass.sourceSnapshotId,
    txDigest: parsed.data.permitDigest,
    body: {
      ...pass,
      message: "Permit digest submitted. Waiting for official chain confirmation before marking RoutePass consumed.",
    },
  });
});

app.get("/beacons", (_req, res) => {
  res.json({ beacons: store.listBeacons() });
});

app.post("/distress", async (req, res) => {
  const parsed = distressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/distress", parsed.data.allianceId);
  if (!context) {
    return;
  }

  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }

  if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for distress creation", 403);
    return;
  }

  if (isOfficialMode() && !parsed.data.locationProof) {
    failWrite(res, context, "LOCATION_PROOF_REQUIRED", "locationProof is required in official_live mode", 400);
    return;
  }
  if ((parsed.data.bondAmount ?? 0) < minDistressBond) {
    failWrite(res, context, "DISTRESS_BOND_TOO_LOW", `bondAmount must be >= ${minDistressBond}`, 400);
    return;
  }

  const ip = getRequestIp(req);

  if (
    !enforceRateLimit(
      res,
      context,
      `distress:character:${ip}:${context.actor}:${parsed.data.characterId}`,
      distressCharacterLimitPerMinute,
      60_000,
    )
  ) {
    return;
  }

  if (
    !enforceRateLimit(
      res,
      context,
      `distress:alliance:${ip}:${context.allianceId}`,
      distressAllianceLimitPerHour,
      3_600_000,
    )
  ) {
    return;
  }

  const liveSnapshot = await getLiveSnapshot();
  const created = store.createOrUpdateDistress(
    {
      beaconId: `beacon-${randomUUID()}`,
      allianceId: parsed.data.allianceId,
      characterId: parsed.data.characterId,
      systemId: parsed.data.systemId,
      threatLevel: parsed.data.threatLevel,
      bondAmount: parsed.data.bondAmount ?? minDistressBond,
      locationProofHash: parsed.data.locationProof ? store.hashLocationProof(parsed.data.locationProof) : null,
      chainDigest: parsed.data.chainDigest ?? null,
    },
    30_000,
    liveSnapshot,
  );

  const intel = store.appendIntel({
    id: `intel-${randomUUID()}`,
    kind: "threat",
    channel: "intel.threat",
    headline: `Distress beacon ${created.deduped ? "updated" : "raised"} in ${created.beacon.systemId}`,
    summary: `${created.beacon.characterId} requested ${created.beacon.threatLevel} threat response.`,
    createdAt: new Date().toISOString(),
  });
  broadcastIntel(intel);

  finalizeWrite(res, context, {
    statusCode: created.deduped ? 200 : 201,
    sourceSnapshotId: created.beacon.sourceSnapshotId,
    body: {
      ...created.beacon,
      deduped: created.deduped,
    },
    txDigest: created.beacon.chainDigest,
  });
});

app.post("/distress/respond", (req, res) => {
  const parsed = responderAcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/distress/respond", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for response acceptance", 403);
    return;
  }

  const beacon = store.acceptResponder({
    beaconId: parsed.data.beaconId,
    responderId: parsed.data.responderId,
    bondAmount: parsed.data.bondAmount,
  });
  if (!beacon) {
    failWrite(res, context, "RESPONDER_ALREADY_JOINED", "Responder already joined or beacon cannot be claimed", 409);
    return;
  }

  const intel = store.appendIntel({
    id: `intel-${randomUUID()}`,
    kind: "threat",
    channel: "intel.threat",
    headline: `Responder accepted distress ${beacon.beaconId}`,
    summary: `${parsed.data.responderId} posted bond ${parsed.data.bondAmount}.`,
    createdAt: new Date().toISOString(),
  });
  broadcastIntel(intel);

  finalizeWrite(res, context, {
    statusCode: 200,
    sourceSnapshotId: beacon.sourceSnapshotId,
    body: beacon,
  });
});

app.get("/incidents", (_req, res) => {
  res.json({ incidents: store.listIncidents() });
});

app.get("/incidents/:id", (req, res) => {
  const incident = store.getIncident(req.params.id);
  if (!incident) {
    return res.status(404).json(buildApiError("INCIDENT_NOT_FOUND", "Incident not found"));
  }
  return res.json({
    ...incident,
    chainTrace: {
      digest: incident.chainDigest,
      eventSeq: incident.chainEventSeq,
      sourceEventRange: incident.sourceEventRange,
      sourceSnapshotId: incident.sourceSnapshotId,
    },
  });
});

app.post("/incident/attach", async (req, res) => {
  const parsed = incidentAttachSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/incident/attach", parsed.data.allianceId);
  if (!context) {
    return;
  }

  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for incident attachment", 403);
    return;
  }

  if (parsed.data.killmailRef) {
    const existingByKillmail = store.findIncidentByKillmailRef(parsed.data.killmailRef);
    if (existingByKillmail && existingByKillmail.incidentId !== parsed.data.incidentId) {
      failWrite(res, context, "KILLMAIL_ALREADY_LINKED", "Killmail already linked to another incident", 409);
      return;
    }
  }

  const liveSnapshot = await getLiveSnapshot();
  const incident = store.upsertIncident(
    {
      incidentId: parsed.data.incidentId,
      beaconId: parsed.data.beaconId ?? null,
      title: parsed.data.title,
      allianceId: parsed.data.allianceId,
      summary: parsed.data.summary,
      operatorComment: parsed.data.operatorComment ?? null,
      killmailRef: parsed.data.killmailRef,
      evidenceCount: parsed.data.evidenceCount,
      evidenceHashes: parsed.data.evidenceHashes,
      verdict: "pending",
      updatedAt: new Date().toISOString(),
      sourceSnapshotId: parsed.data.sourceSnapshotId,
      sourceEventRange: parsed.data.sourceEventRange,
      chainDigest: parsed.data.chainDigest ?? null,
      chainEventSeq: parsed.data.chainEventSeq ?? null,
    },
    liveSnapshot,
  );

  const intel = store.appendIntel({
    id: `intel-${randomUUID()}`,
    kind: "claims",
    channel: "intel.claims",
    headline: `Incident case updated: ${incident.title}`,
    summary: `Evidence count ${incident.evidenceCount}; awaiting auditor approval.`,
    createdAt: new Date().toISOString(),
  });
  broadcastIntel(intel);

  finalizeWrite(res, context, {
    statusCode: 201,
    sourceSnapshotId: incident.sourceSnapshotId,
    body: incident,
    txDigest: incident.chainDigest,
  });
});

app.post("/incidents/:id/auditor-approve", (req, res) => {
  const parsed = auditorApproveSchema.safeParse({
    ...req.body,
    incidentId: req.params.id,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/incidents/:id/auditor-approve", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  if (!hasRole(context.roleBits, ROLE_AUDITOR)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Auditor role is required for incident approval", 403);
    return;
  }

  const incident = store.auditorApproveIncident(parsed.data.incidentId, context.actor, parsed.data.auditorComment);
  if (!incident) {
    failWrite(res, context, "INCIDENT_STATE_INVALID", "Incident is not eligible for auditor approval", 409);
    return;
  }

  const intel = store.appendIntel({
    id: `intel-${randomUUID()}`,
    kind: "claims",
    channel: "intel.claims",
    headline: `Auditor approved ${incident.incidentId}`,
    summary: `${context.actor} approved incident; awaiting insurer payout approval.`,
    createdAt: new Date().toISOString(),
  });
  broadcastIntel(intel);

  finalizeWrite(res, context, {
    statusCode: 200,
    sourceSnapshotId: incident.sourceSnapshotId,
    body: incident,
    txDigest: incident.chainDigest,
  });
});

app.post("/incidents/:id/insurer-approve", (req, res) => {
  const parsed = insurerApproveSchema.safeParse({
    ...req.body,
    incidentId: req.params.id,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/incidents/:id/insurer-approve", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  if (!hasRole(context.roleBits, ROLE_INSURER)) {
    failWrite(res, context, "FORBIDDEN_ROLE", "Insurer role is required for payout approval", 403);
    return;
  }

  const incident = store.insurerApproveAndExecutePayout(
    parsed.data.incidentId,
    context.actor,
    parsed.data.insurerComment,
    parsed.data.payoutPlan,
  );
  if (!incident) {
    failWrite(res, context, "INCIDENT_STATE_INVALID", "Incident must be auditor-approved before payout", 409);
    return;
  }

  const payoutDigest = store.newDigest();
  const intel = store.appendIntel({
    id: `intel-${randomUUID()}`,
    kind: "claims",
    channel: "intel.claims",
    headline: `Insurer executed payout for ${incident.incidentId}`,
    summary: `Total payout ${incident.payoutTotal} approved by ${context.actor}.`,
    createdAt: new Date().toISOString(),
  });
  broadcastIntel(intel);

  finalizeWrite(res, context, {
    statusCode: 200,
    sourceSnapshotId: incident.sourceSnapshotId,
    body: {
      ...incident,
      payoutDigest,
    },
    txDigest: payoutDigest,
  });
});

app.get("/policies/:id", (req, res) => {
  const policy = store.getPolicy(req.params.id);
  if (!policy) {
    return res.status(404).json(buildApiError("POLICY_NOT_FOUND", "Policy not found"));
  }
  return res.json(policy);
});

app.post("/policies/:id/dry-run", (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const current = store.getPolicy(req.params.id);
  if (!current) {
    return res.status(404).json(buildApiError("POLICY_NOT_FOUND", "Policy not found"));
  }

  const next = {
    mode: parsed.data.mode,
    tollBase: parsed.data.tollBase,
    riskMultiplier: parsed.data.riskMultiplier,
    civilianProtection: parsed.data.civilianProtection,
    treatyExemptions: parsed.data.treatyExemptions,
    redlist: parsed.data.redlist,
    whitelist: parsed.data.whitelist,
  };

  const tollDelta = next.tollBase - current.tollBase;
  const riskDeltaPct = ((next.riskMultiplier - current.riskMultiplier) / current.riskMultiplier) * 100;
  const redlistDelta = next.redlist.length - current.redlist.length;
  const whitelistDelta = next.whitelist.length - current.whitelist.length;

  return res.json({
    policyId: req.params.id,
    expectedVersion: store.getLatestPolicyVersion(req.params.id),
    current,
    next,
    impact: {
      tollDelta,
      riskDeltaPct: Number(riskDeltaPct.toFixed(2)),
      redlistDelta,
      whitelistDelta,
      modeChanged: current.mode !== next.mode,
    },
  });
});

app.get("/policies/:id/versions", (req, res) => {
  return res.json({
    policyId: req.params.id,
    versions: store.listPolicyVersions(req.params.id),
  });
});

app.get("/policy/proposals", (req, res) => {
  const allianceId = typeof req.query.allianceId === "string" ? req.query.allianceId : undefined;
  return res.json({
    proposals: store.listPolicyProposals(allianceId),
  });
});

app.post("/policies/proposals", (req, res) => {
  const parsed = policyProposalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const context = parseWriteContext(req, res, "/policies/proposals", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  void (async () => {
    const ownerCapCheck = await verifyOwnerCap(req, liveUniverse.getMode());
    if (!ownerCapCheck.ok) {
      failWrite(res, context, ownerCapCheck.errorCode, ownerCapCheck.message, 403);
      return;
    }
    if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
      failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for policy proposal", 403);
      return;
    }

    const proposal = store.proposePolicyChange({
      policyId: parsed.data.policyId,
      allianceId: parsed.data.allianceId,
      proposer: context.actor,
      reason: parsed.data.reason,
      changes: parsed.data.changes,
    });

    const intel = store.appendIntel({
      id: `intel-${randomUUID()}`,
      kind: "policy",
      channel: "intel.policy",
      headline: `Policy proposal ${proposal.proposalId} created`,
      summary: `Proposal for ${proposal.policyId} requires dual approval: ${proposal.requiresDualApproval}.`,
      createdAt: new Date().toISOString(),
    });
    broadcastIntel(intel);

    finalizeWrite(res, context, {
      statusCode: 201,
      sourceSnapshotId: `proposal-${proposal.proposalId}`,
      body: proposal,
    });
  })();
});

app.post("/policies/proposals/:proposalId/approve", (req, res) => {
  const parsed = policyApprovalSchema.safeParse({
    ...req.body,
    proposalId: req.params.proposalId,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const context = parseWriteContext(req, res, "/policies/proposals/:proposalId/approve", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  void (async () => {
    const ownerCapCheck = await verifyOwnerCap(req, liveUniverse.getMode());
    if (!ownerCapCheck.ok) {
      failWrite(res, context, ownerCapCheck.errorCode, ownerCapCheck.message, 403);
      return;
    }
    if (!(hasRole(context.roleBits, ROLE_AUDITOR) || hasRole(context.roleBits, ROLE_TREATY_ADMIN))) {
      failWrite(res, context, "FORBIDDEN_ROLE", "Auditor or treaty admin role is required", 403);
      return;
    }

    const proposal = store.approvePolicyProposal(
      parsed.data.proposalId,
      context.actor,
      parsed.data.approverComment,
      context.roleBits,
    );
    if (!proposal) {
      failWrite(res, context, "POLICY_PROPOSAL_INVALID", "Proposal not found or already finalized", 404);
      return;
    }

    const intel = store.appendIntel({
      id: `intel-${randomUUID()}`,
      kind: "policy",
      channel: "intel.policy",
      headline:
        proposal.status === "approved"
          ? `Policy proposal ${proposal.proposalId} approved`
          : `Policy proposal ${proposal.proposalId} partially approved`,
      summary:
        proposal.status === "approved"
          ? `${proposal.policyId} updated by ${context.actor}.`
          : `${proposal.policyId} is waiting for second role approval.`,
      createdAt: new Date().toISOString(),
    });
    broadcastIntel(intel);

    const isApproved = proposal.status === "approved";
    finalizeWrite(res, context, {
      statusCode: isApproved ? 200 : 202,
      sourceSnapshotId: `proposal-${proposal.proposalId}`,
      body: proposal,
    });
  })();
});

app.post("/policies/:id/rollback", (req, res) => {
  const parsed = policyRollbackSchema.safeParse({
    ...req.body,
    policyId: req.params.id,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const context = parseWriteContext(req, res, "/policies/:id/rollback", parsed.data.allianceId);
  if (!context) {
    return;
  }
  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  void (async () => {
    const ownerCapCheck = await verifyOwnerCap(req, liveUniverse.getMode());
    if (!ownerCapCheck.ok) {
      failWrite(res, context, ownerCapCheck.errorCode, ownerCapCheck.message, 403);
      return;
    }
    if (!(hasRole(context.roleBits, ROLE_OPERATOR) && hasRole(context.roleBits, ROLE_AUDITOR))) {
      failWrite(res, context, "FORBIDDEN_ROLE", "Rollback requires operator + auditor roles", 403);
      return;
    }

    const policy = store.rollbackPolicy(
      parsed.data.policyId,
      parsed.data.targetVersion,
      context.actor,
      `rollback:${parsed.data.reason}`,
    );
    if (!policy) {
      failWrite(res, context, "POLICY_VERSION_NOT_FOUND", "Target policy version does not exist", 404);
      return;
    }

    const intel = store.appendIntel({
      id: `intel-${randomUUID()}`,
      kind: "policy",
      channel: "intel.policy",
      headline: `Policy ${parsed.data.policyId} rolled back`,
      summary: `Rollback to version ${parsed.data.targetVersion} approved by ${context.actor}.`,
      createdAt: new Date().toISOString(),
    });
    broadcastIntel(intel);

    finalizeWrite(res, context, {
      statusCode: 200,
      sourceSnapshotId: `rollback-${parsed.data.policyId}-${parsed.data.targetVersion}`,
      body: policy,
    });
  })();
});

app.put("/policies/:id", (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const context = parseWriteContext(req, res, "/policies/:id", getHeaderValue(req, "x-alliance-id") ?? "alliance-alpha");
  if (!context) {
    return;
  }

  if (ensureIdempotency(req, res, context) === "handled") {
    return;
  }
  void (async () => {
    const ownerCapCheck = await verifyOwnerCap(req, liveUniverse.getMode());
    if (!ownerCapCheck.ok) {
      failWrite(res, context, ownerCapCheck.errorCode, ownerCapCheck.message, 403);
      return;
    }
    if (!hasRole(context.roleBits, ROLE_OPERATOR)) {
      failWrite(res, context, "FORBIDDEN_ROLE", "Operator role is required for policy updates", 403);
      return;
    }

    const latestVersion = store.getLatestPolicyVersion(req.params.id);
    if (
      parsed.data.expectedVersion !== undefined &&
      latestVersion !== null &&
      parsed.data.expectedVersion !== latestVersion
    ) {
      failWrite(
        res,
        context,
        "POLICY_VERSION_CONFLICT",
        `Expected policy version ${parsed.data.expectedVersion}, latest is ${latestVersion}`,
        409,
      );
      return;
    }

    const policy = store.setPolicy(
      req.params.id,
      {
        mode: parsed.data.mode,
        tollBase: parsed.data.tollBase,
        riskMultiplier: parsed.data.riskMultiplier,
        civilianProtection: parsed.data.civilianProtection,
        treatyExemptions: parsed.data.treatyExemptions,
        redlist: parsed.data.redlist,
        whitelist: parsed.data.whitelist,
      },
      context.actor,
      "direct-write",
    );
    const snapshot = store.nextLiveSnapshot();

    const intel = store.appendIntel({
      id: `intel-${randomUUID()}`,
      kind: "policy",
      channel: "intel.policy",
      headline: `Policy ${req.params.id} switched to ${policy.mode}`,
      summary: `Toll ${policy.tollBase}, multiplier ${policy.riskMultiplier.toFixed(2)}, civilian protection ${policy.civilianProtection}.`,
      createdAt: new Date().toISOString(),
    });
    broadcastIntel(intel);

    finalizeWrite(res, context, {
      statusCode: 200,
      sourceSnapshotId: snapshot.sourceSnapshotId,
      body: policy,
    });
  })();
});

app.get("/intel", (req, res) => {
  const sinceSequenceRaw = req.query.lastSequence;
  const sinceSequence = typeof sinceSequenceRaw === "string" ? Number(sinceSequenceRaw) : undefined;
  const messages = Number.isFinite(sinceSequence) ? store.listIntel(sinceSequence) : store.listIntel();
  res.json({ messages });
});

app.get("/audit", (_req, res) => {
  res.json({ records: store.listAudit(200) });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/intel-stream" });

function broadcastIntel(message: IntelMessage) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
  store.recordWsBroadcast();
}

wss.on("connection", (socket, request) => {
  store.recordWsConnectionOpen();
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const lastSequenceParam = requestUrl.searchParams.get("lastSequence");
  const lastSequence = lastSequenceParam ? Number(lastSequenceParam) : undefined;
  const backlog = Number.isFinite(lastSequence)
    ? store
        .listIntel(lastSequence)
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
    : store
        .listIntel()
        .slice(0, 20)
        .sort((a, b) => a.sequence - b.sequence);

  for (const message of backlog) {
    socket.send(JSON.stringify(message));
  }

  socket.on("close", () => {
    store.recordWsConnectionClose();
  });
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  eventIndexer.start();
  grpcStream.start();
  console.log(`Aegis Mesh API listening on http://localhost:${port}`);
});
