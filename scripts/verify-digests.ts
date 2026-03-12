import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface AuditRecord {
  requestId: string;
  endpoint: string;
  actor: string;
  allianceId: string;
  sourceSnapshotId: string;
  txDigest?: string | null;
  createdAt: string;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface TxLookupResult {
  digest?: string;
  checkpoint?: string;
  timestampMs?: string;
}

function utcTag(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch-failed:${url}:${res.status}`);
  }
  return (await res.json()) as T;
}

async function verifyDigest(rpcUrl: string, digest: string): Promise<{
  ok: boolean;
  checkpoint: string | null;
  timestampMs: string | null;
  error: string | null;
}> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "aegis-verify-digest",
        method: "sui_getTransactionBlock",
        params: [digest, { showInput: false, showEvents: true, showEffects: true }],
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        checkpoint: null,
        timestampMs: null,
        error: `rpc-http-${response.status}`,
      };
    }
    const payload = (await response.json()) as JsonRpcResponse<TxLookupResult>;
    if (payload.error || !payload.result?.digest) {
      return {
        ok: false,
        checkpoint: null,
        timestampMs: null,
        error: payload.error?.message ?? "digest-not-found",
      };
    }
    return {
      ok: true,
      checkpoint: payload.result.checkpoint ?? null,
      timestampMs: payload.result.timestampMs ?? null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      checkpoint: null,
      timestampMs: null,
      error: error instanceof Error ? error.message : "unknown-verify-error",
    };
  }
}

function toReport(
  apiBaseUrl: string,
  rpcUrl: string,
  records: AuditRecord[],
  results: Array<{
    record: AuditRecord;
    digest: string;
    verified: Awaited<ReturnType<typeof verifyDigest>>;
  }>,
): string {
  const generatedAt = new Date().toISOString();
  const verifiedCount = results.filter((item) => item.verified.ok).length;

  return `# Digest Verification Report

Generated at: ${generatedAt}
API base: ${apiBaseUrl}
RPC: ${rpcUrl}

## Summary

- audit records scanned: ${records.length}
- digest candidates: ${results.length}
- verified on-chain: ${verifiedCount}
- failed verification: ${results.length - verifiedCount}

## Details

${results.length === 0
    ? "- no digest found in audit records"
    : results
        .map((item) => {
          const status = item.verified.ok ? "OK" : "FAILED";
          return `- [${status}] ${item.digest} | endpoint=${item.record.endpoint} | requestId=${item.record.requestId} | checkpoint=${item.verified.checkpoint ?? "n/a"} | timestampMs=${item.verified.timestampMs ?? "n/a"} | error=${item.verified.error ?? "none"}`;
        })
        .join("\n")}

## Next Steps

1. For each FAILED digest, verify network/rpc configuration and replay the flow.
2. Keep at least 3 OK digests for final hackathon evidence.
3. Include this report in \`docs/stillness-evidence\` with the demo video submission.
`;
}

async function main(): Promise<void> {
  const apiBaseUrl = process.env.AEGIS_API_BASE_URL ?? "http://localhost:4000";
  const rpcUrl = process.env.SUI_RPC_URL ?? process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "http://localhost:9000";
  const audit = await fetchJson<{ records: AuditRecord[] }>(`${apiBaseUrl}/audit`);
  const digestRecords = audit.records.filter(
    (record) => typeof record.txDigest === "string" && record.txDigest.startsWith("0x"),
  );

  const results: Array<{
    record: AuditRecord;
    digest: string;
    verified: Awaited<ReturnType<typeof verifyDigest>>;
  }> = [];

  for (const record of digestRecords) {
    const digest = record.txDigest as string;
    const verified = await verifyDigest(rpcUrl, digest);
    results.push({
      record,
      digest,
      verified,
    });
  }

  const report = toReport(apiBaseUrl, rpcUrl, audit.records, results);
  const outputDir = join(process.cwd(), "docs", "stillness-evidence");
  await mkdir(outputDir, { recursive: true });
  const taggedPath = join(outputDir, `digest-verify-${utcTag()}.md`);
  const latestPath = join(outputDir, "digest-verify-latest.md");
  await Promise.all([
    writeFile(taggedPath, report, "utf8"),
    writeFile(latestPath, report, "utf8"),
  ]);
  process.stdout.write(`Digest verification report written to ${taggedPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Failed to verify digests: ${String(error)}\n`);
  process.exitCode = 1;
});
