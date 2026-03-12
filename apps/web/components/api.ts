import type {
  DistressBeacon,
  IncidentCase,
  IntelMessage,
  NodeRegistration,
  PolicyProfile,
  RouteQuote,
} from "@aegis-mesh/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_ALLIANCE_ID = process.env.NEXT_PUBLIC_ALLIANCE_ID ?? "alliance-alpha";
const DEFAULT_ACTOR = process.env.NEXT_PUBLIC_ACTOR_ADDRESS ?? "pilot-blue-01";
const DEFAULT_ROLE_BITS = Number(process.env.NEXT_PUBLIC_ROLE_BITS ?? "1");
const DEFAULT_OWNER_CAP_ID = process.env.NEXT_PUBLIC_OWNER_CAP_ID;
const DEFAULT_ADMIN_ACL_ID = process.env.NEXT_PUBLIC_ADMIN_ACL_ID;

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildWriteHeaders(overrides?: {
  allianceId?: string;
  actorAddress?: string;
  roleBits?: number;
  idempotencyKey?: string;
  ownerCapId?: string;
  adminAclId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": overrides?.idempotencyKey ?? makeIdempotencyKey(),
    "X-Request-Timestamp": Date.now().toString(),
    "X-Alliance-Id": overrides?.allianceId ?? DEFAULT_ALLIANCE_ID,
    "X-Actor-Address": overrides?.actorAddress ?? DEFAULT_ACTOR,
    "X-Role-Bits": String(overrides?.roleBits ?? DEFAULT_ROLE_BITS),
  };
  const ownerCapId = overrides?.ownerCapId ?? DEFAULT_OWNER_CAP_ID;
  const adminAclId = overrides?.adminAclId ?? DEFAULT_ADMIN_ACL_ID;
  if (ownerCapId) {
    headers["X-Owner-Cap-Id"] = ownerCapId;
  }
  if (adminAclId) {
    headers["X-Admin-Acl-Id"] = adminAclId;
  }
  return headers;
}

export async function fetchNodes(): Promise<
  Array<NodeRegistration & { policy: PolicyProfile | null }>
> {
  const res = await fetch(`${API_BASE}/nodes`, { cache: "no-store" });
  const data = (await res.json()) as {
    nodes: Array<NodeRegistration & { policy: PolicyProfile | null }>;
  };
  return data.nodes;
}

export async function fetchIncidents(): Promise<IncidentCase[]> {
  const res = await fetch(`${API_BASE}/incidents`, { cache: "no-store" });
  const data = (await res.json()) as { incidents: IncidentCase[] };
  return data.incidents;
}

export async function fetchBeacons(): Promise<DistressBeacon[]> {
  const res = await fetch(`${API_BASE}/beacons`, { cache: "no-store" });
  const data = (await res.json()) as { beacons: DistressBeacon[] };
  return data.beacons;
}

export async function fetchIntel(): Promise<IntelMessage[]> {
  const res = await fetch(`${API_BASE}/intel`, { cache: "no-store" });
  const data = (await res.json()) as { messages: IntelMessage[] };
  return data.messages;
}

export async function fetchRouteQuote(
  mode: "safe" | "cheap" | "fast",
  sourceSnapshotId = "client-snapshot",
): Promise<RouteQuote> {
  const params = new URLSearchParams({
    from: "stillness-alpha-7",
    to: "trade-hub-iv",
    mode,
    sourceSnapshotId,
  });
  const res = await fetch(`${API_BASE}/route/quote?${params.toString()}`, {
    cache: "no-store",
  });
  return (await res.json()) as RouteQuote;
}

export async function fetchLiveStatus(): Promise<{
  configuredMode?: "official_live" | "simulated" | "stale";
  dataSource: "official_live" | "simulated" | "stale";
  latestIntelSequence: number;
  hasOfficialBinding: boolean;
  grpcStream?: {
    enabled: boolean;
    running: boolean;
    lastConnectedAt: string | null;
    lastError: string | null;
    lastEventSeq: string | null;
    totalEvents: number;
  };
  liveStatus?: {
    rpcHealthy: boolean;
    graphqlHealthy: boolean;
    grpcHealthy: boolean;
    lastError: string | null;
    lastGrpcEventSeq: string | null;
    lastSnapshot: {
      sourceSnapshotId: string;
      sourceEventRange: { from: number; to: number };
      dataFreshnessMs: number;
      dataSource: "official_live" | "simulated" | "stale";
      blockHeight?: number;
    } | null;
  };
}> {
  const res = await fetch(`${API_BASE}/live/status`, { cache: "no-store" });
  return (await res.json()) as {
    configuredMode?: "official_live" | "simulated" | "stale";
    dataSource: "official_live" | "simulated" | "stale";
    latestIntelSequence: number;
    hasOfficialBinding: boolean;
    grpcStream?: {
      enabled: boolean;
      running: boolean;
      lastConnectedAt: string | null;
      lastError: string | null;
      lastEventSeq: string | null;
      totalEvents: number;
    };
    liveStatus?: {
      rpcHealthy: boolean;
      graphqlHealthy: boolean;
      grpcHealthy: boolean;
      lastError: string | null;
      lastGrpcEventSeq: string | null;
      lastSnapshot: {
        sourceSnapshotId: string;
        sourceEventRange: { from: number; to: number };
        dataFreshnessMs: number;
        dataSource: "official_live" | "simulated" | "stale";
        blockHeight?: number;
      } | null;
    };
  };
}

export async function fetchIndexerStatus(): Promise<{
  indexer: {
    enabled: boolean;
    running: boolean;
    pollIntervalMs: number;
    lastPollAt: string | null;
    lastError: string | null;
    totalEvents: number;
    lastCursor: { txDigest: string; eventSeq: string } | null;
    pendingRoutePasses: number;
  };
}> {
  const res = await fetch(`${API_BASE}/indexer/status`, { cache: "no-store" });
  return (await res.json()) as {
    indexer: {
      enabled: boolean;
      running: boolean;
      pollIntervalMs: number;
      lastPollAt: string | null;
      lastError: string | null;
      totalEvents: number;
      lastCursor: { txDigest: string; eventSeq: string } | null;
      pendingRoutePasses: number;
    };
  };
}
