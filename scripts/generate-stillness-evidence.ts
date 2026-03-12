import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface LiveStatusResponse {
  dataSource: "official_live" | "simulated" | "stale";
  latestIntelSequence: number;
  hasOfficialBinding: boolean;
  liveStatus: {
    mode: string;
    rpcUrl: string;
    graphqlUrl: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    rpcHealthy: boolean;
    graphqlHealthy: boolean;
    grpcHealthy: boolean;
    lastGrpcEventSeq: string | null;
    lastSnapshot: {
      sourceSnapshotId: string;
      sourceEventRange: { from: number; to: number };
      dataFreshnessMs: number;
      dataSource: string;
      blockHeight?: number;
    } | null;
  };
}

interface MetricsResponse {
  metrics: Record<string, string | number | boolean | null>;
}

interface AuditResponse {
  records: Array<{
    requestId: string;
    endpoint: string;
    actor: string;
    roleBits: number;
    allianceId: string;
    sourceSnapshotId: string;
    result: "success" | "failed";
    txDigest?: string | null;
    createdAt: string;
  }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Fetch failed ${url} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

function nowTag(): string {
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function toMarkdown(
  baseUrl: string,
  live: LiveStatusResponse,
  metrics: MetricsResponse,
  audit: AuditResponse,
): string {
  const timestamp = new Date().toISOString();
  const digestRecords = audit.records
    .filter((record) => typeof record.txDigest === "string" && record.txDigest.startsWith("0x"))
    .slice(0, 10);

  const envLines = [
    `NEXT_PUBLIC_SUI_NETWORK=${process.env.NEXT_PUBLIC_SUI_NETWORK ?? "<unset>"}`,
    `NEXT_PUBLIC_SUI_RPC_URL=${process.env.NEXT_PUBLIC_SUI_RPC_URL ?? process.env.SUI_RPC_URL ?? "<unset>"}`,
    `NEXT_PUBLIC_SUI_GRAPHQL_URL=${process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL ?? process.env.SUI_GRAPHQL_URL ?? "<unset>"}`,
    `NEXT_PUBLIC_API_BASE_URL=${process.env.NEXT_PUBLIC_API_BASE_URL ?? baseUrl}`,
    `NEXT_PUBLIC_CHAIN_EXPLORER_BASE=${process.env.NEXT_PUBLIC_CHAIN_EXPLORER_BASE ?? "<unset>"}`,
  ];
  const explorerBase = process.env.NEXT_PUBLIC_CHAIN_EXPLORER_BASE ?? "";
  const operatorAddress = process.env.EVIDENCE_OPERATOR_ADDRESS ?? "<unset>";
  const pilotAddress = process.env.EVIDENCE_PILOT_ADDRESS ?? "<unset>";
  const responderAddress = process.env.EVIDENCE_RESPONDER_ADDRESS ?? "<unset>";
  const minGasHint = process.env.EVIDENCE_MIN_GAS_HINT ?? ">= 0.2 SUI each account";
  const minBondHint = process.env.EVIDENCE_MIN_BOND_HINT ?? ">= 5 SUI for pilot/responder";
  const digestTargets = digestRecords.slice(0, 3);

  return `# Aegis Mesh Stillness Evidence

Generated at: ${timestamp}
API base: ${baseUrl}

## 1. Live Binding Status

- dataSource: ${live.dataSource}
- hasOfficialBinding: ${String(live.hasOfficialBinding)}
- latestIntelSequence: ${live.latestIntelSequence}
- rpcHealthy: ${String(live.liveStatus.rpcHealthy)}
- graphqlHealthy: ${String(live.liveStatus.graphqlHealthy)}
- grpcHealthy: ${String(live.liveStatus.grpcHealthy)}
- lastGrpcEventSeq: ${live.liveStatus.lastGrpcEventSeq ?? "n/a"}
- lastSuccessAt: ${live.liveStatus.lastSuccessAt ?? "n/a"}
- lastError: ${live.liveStatus.lastError ?? "n/a"}
- sourceSnapshotId: ${live.liveStatus.lastSnapshot?.sourceSnapshotId ?? "n/a"}
- sourceEventRange: ${live.liveStatus.lastSnapshot ? `${live.liveStatus.lastSnapshot.sourceEventRange.from}-${live.liveStatus.lastSnapshot.sourceEventRange.to}` : "n/a"}
- blockHeight: ${live.liveStatus.lastSnapshot?.blockHeight ?? "n/a"}

## 2. Stillness Connection Config

${envLines.map((line) => `- ${line}`).join("\n")}

Preflight checks:
- wallet connected to stillness: ${process.env.EVIDENCE_WALLET_CONNECTED ?? "manual-check"}
- graphql latest checkpoint available: ${String(live.liveStatus.graphqlHealthy)}
- rpc live checkpoint available: ${String(live.liveStatus.rpcHealthy)}
- overlay bridge event observed (\`PLAYER_ENTERED_RANGE\`): ${process.env.EVIDENCE_BRIDGE_OK ?? "manual-check"}

## 3. Test Accounts And Asset Prep

- operator: ${operatorAddress}
- pilot: ${pilotAddress}
- responder: ${responderAddress}
- gas hint: ${minGasHint}
- bond hint: ${minBondHint}

## 4. Runtime Metrics

${Object.entries(metrics.metrics)
  .map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
  .join("\n")}

## 5. Transaction Digest Evidence

${digestRecords.length === 0
    ? "- No txDigest records found yet. Execute sponsor/distress/incident payout flows before final submission."
    : digestRecords
        .map(
          (record) => {
            const txDigest = record.txDigest as string;
            const explorer = explorerBase ? `${explorerBase.replace(/\/$/, "")}/txblock/${txDigest}` : "n/a";
            return `- ${record.createdAt} | ${record.endpoint} | ${txDigest} | actor=${record.actor} | alliance=${record.allianceId} | explorer=${explorer}`;
          },
        )
        .join("\n")}

## 6. Request Audit Samples

${audit.records
  .slice(0, 20)
  .map(
    (record) =>
      `- ${record.createdAt} | ${record.result.toUpperCase()} | ${record.endpoint} | requestId=${record.requestId} | sourceSnapshot=${record.sourceSnapshotId}`,
  )
  .join("\n")}

## 7. Digest Verification Method

${digestTargets.length === 0
    ? "- Need at least 3 on-chain digests for final judging proof."
    : digestTargets
        .map((record, index) => {
          const txDigest = record.txDigest as string;
          return `${index + 1}. Verify digest \`${txDigest}\` from:
- frontend transaction receipt
- backend audit line (\`${record.requestId}\`)
- chain query: \`curl -s $NEXT_PUBLIC_SUI_RPC_URL -H \"Content-Type: application/json\" -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getTransactionBlock\",\"params\":[\"${txDigest}\",{\"showEffects\":true,\"showEvents\":true}]}'\``;
        })
        .join("\n\n")}

## 8. Final Recording Checklist

- include non-sim live overlay flow in video (5-8 min)
- include at least 3 official stillness digests
- include sourceSnapshotId/sourceEventRange on screen or logs
- ensure ops panel and overlay show consistent state for the same action

## 9. Verification Steps

1. Capture in-game overlay flow video with visible mode and source snapshot.
2. Cross-check each txDigest above in explorer / RPC query output.
3. Verify incident and distress records in API endpoints match the same digest and snapshot.
4. Include this file and raw API JSON captures in the submission evidence package.
`;
}

async function main() {
  const baseUrl = process.env.AEGIS_API_BASE_URL ?? "http://localhost:4000";
  const [live, metrics, audit] = await Promise.all([
    fetchJson<LiveStatusResponse>(`${baseUrl}/live/status`),
    fetchJson<MetricsResponse>(`${baseUrl}/metrics`),
    fetchJson<AuditResponse>(`${baseUrl}/audit`),
  ]);

  const markdown = toMarkdown(baseUrl, live, metrics, audit);
  const outputDir = join(process.cwd(), "docs", "stillness-evidence");
  await mkdir(outputDir, { recursive: true });

  const tag = nowTag();
  const filePath = join(outputDir, `evidence-${tag}.md`);
  const latestPath = join(outputDir, "latest.md");

  await Promise.all([
    writeFile(filePath, markdown, "utf8"),
    writeFile(latestPath, markdown, "utf8"),
  ]);

  process.stdout.write(`Evidence written to ${filePath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Failed to generate stillness evidence: ${String(error)}\n`);
  process.exitCode = 1;
});
