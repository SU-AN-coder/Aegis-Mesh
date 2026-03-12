import type { Request } from "express";

export type OfficialCheckResult =
  | { ok: true; mode: "bypass" | "verified" }
  | { ok: false; errorCode: string; message: string };

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface SuiObjectResult {
  data?: {
    objectId: string;
    type?: string;
    owner?: {
      AddressOwner?: string;
      Shared?: unknown;
      Immutable?: boolean;
    };
  } | null;
}

const rpcUrl = process.env.SUI_RPC_URL ?? process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "http://localhost:9000";
const forceOfficialChecks = process.env.REQUIRE_OFFICIAL_ACL === "true";
const requireGovernorCap = process.env.REQUIRE_GOVERNOR_CAP_FOR_ADMIN_ACL === "true";

function header(req: Request, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

interface ObjectVerification {
  exists: boolean;
  type?: string;
  ownerAddress?: string | null;
  isShared: boolean;
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

async function verifyObject(
  objectId: string,
  expectedTypeHint?: string,
): Promise<ObjectVerification> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "aegis-official-auth",
      method: "sui_getObject",
      params: [objectId, { showType: true, showOwner: true }],
    }),
  });
  if (!response.ok) {
    return {
      exists: false,
      isShared: false,
    };
  }
  const data = (await response.json()) as JsonRpcResponse<SuiObjectResult>;
  const objectData = data.result?.data;
  if (!objectData?.objectId) {
    return {
      exists: false,
      isShared: false,
    };
  }
  const objectType = data.result?.data?.type;
  if (expectedTypeHint && !(typeof objectType === "string" && objectType.includes(expectedTypeHint))) {
    return {
      exists: false,
      type: objectType,
      ownerAddress: null,
      isShared: false,
    };
  }

  const owner = objectData.owner;
  const ownerAddress = owner?.AddressOwner ? normalizeAddress(owner.AddressOwner) : null;
  return {
    exists: true,
    type: objectType,
    ownerAddress,
    isShared: Boolean(owner?.Shared),
  };
}

export async function verifyOwnerCap(req: Request, dataSource: "official_live" | "simulated" | "stale"): Promise<OfficialCheckResult> {
  const ownerCapId = header(req, "x-owner-cap-id");
  const actor = normalizeAddress(header(req, "x-actor-address") ?? "");
  if (!forceOfficialChecks && dataSource !== "official_live") {
    return { ok: true, mode: "bypass" };
  }
  if (!ownerCapId) {
    return {
      ok: false,
      errorCode: "OFFICIAL_PERMISSION_REQUIRED",
      message: "OwnerCap is required for this operation in live mode",
    };
  }
  const ownerCap = await verifyObject(ownerCapId, "OwnerCap");
  if (!ownerCap.exists) {
    return {
      ok: false,
      errorCode: "OFFICIAL_PERMISSION_INVALID",
      message: "OwnerCap object cannot be verified on-chain",
    };
  }
  if (!actor || !ownerCap.ownerAddress || ownerCap.ownerAddress !== actor) {
    return {
      ok: false,
      errorCode: "OFFICIAL_PERMISSION_MISMATCH",
      message: "OwnerCap is not owned by the acting address",
    };
  }
  return { ok: true, mode: "verified" };
}

export async function verifyAdminAcl(req: Request, dataSource: "official_live" | "simulated" | "stale"): Promise<OfficialCheckResult> {
  const adminAclId = header(req, "x-admin-acl-id");
  const governorCapId = header(req, "x-governor-cap-id");
  const actor = normalizeAddress(header(req, "x-actor-address") ?? "");
  if (!forceOfficialChecks && dataSource !== "official_live") {
    return { ok: true, mode: "bypass" };
  }
  if (!adminAclId) {
    return {
      ok: false,
      errorCode: "OFFICIAL_PERMISSION_REQUIRED",
      message: "AdminACL is required for sponsor verification in live mode",
    };
  }
  const adminAcl = await verifyObject(adminAclId, "AdminACL");
  if (!adminAcl.exists) {
    return {
      ok: false,
      errorCode: "OFFICIAL_PERMISSION_INVALID",
      message: "AdminACL object cannot be verified on-chain",
    };
  }
  if (requireGovernorCap && !governorCapId) {
    return {
      ok: false,
      errorCode: "OFFICIAL_PERMISSION_REQUIRED",
      message: "GovernorCap is required for AdminACL verification in live mode",
    };
  }
  if (governorCapId) {
    const governorCap = await verifyObject(governorCapId, "GovernorCap");
    if (!governorCap.exists) {
      return {
        ok: false,
        errorCode: "OFFICIAL_PERMISSION_INVALID",
        message: "GovernorCap object cannot be verified on-chain",
      };
    }
    if (!actor || !governorCap.ownerAddress || governorCap.ownerAddress !== actor) {
      return {
        ok: false,
        errorCode: "OFFICIAL_PERMISSION_MISMATCH",
        message: "GovernorCap is not owned by the acting address",
      };
    }
  }
  return { ok: true, mode: "verified" };
}
