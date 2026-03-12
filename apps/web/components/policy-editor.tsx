"use client";

import { useEffect, useState, useTransition } from "react";
import type { ChangeEvent } from "react";

import type { PolicyMode } from "@aegis-mesh/shared";

import { buildWriteHeaders } from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type DryRunResponse = {
  expectedVersion: number | null;
  impact: {
    tollDelta: number;
    riskDeltaPct: number;
    redlistDelta: number;
    whitelistDelta: number;
    modeChanged: boolean;
  };
};

export function PolicyEditor({ policyId }: { policyId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState({
    mode: "wartime" as PolicyMode,
    tollBase: 12,
    riskMultiplier: 1.4,
    civilianProtection: true,
    treatyExemptions: "alliance-beta",
    redlist: "pilot-red-01,pilot-red-02",
    whitelist: "pilot-blue-01",
    expectedVersion: null as number | null,
    status: "",
    dryRun: null as DryRunResponse | null,
  });

  useEffect(() => {
    let disposed = false;
    async function loadPolicy() {
      const [policyRes, versionsRes] = await Promise.all([
        fetch(`${API_BASE}/policies/${policyId}`),
        fetch(`${API_BASE}/policies/${policyId}/versions`),
      ]);
      if (!policyRes.ok || !versionsRes.ok || disposed) {
        return;
      }

      const policy = (await policyRes.json()) as {
        mode: PolicyMode;
        tollBase: number;
        riskMultiplier: number;
        civilianProtection: boolean;
        treatyExemptions: string[];
        redlist: string[];
        whitelist: string[];
      };
      const versions = (await versionsRes.json()) as {
        versions: Array<{ version: number }>;
      };

      const expectedVersion = versions.versions[0]?.version ?? null;
      setState((current) => ({
        ...current,
        mode: policy.mode,
        tollBase: policy.tollBase,
        riskMultiplier: policy.riskMultiplier,
        civilianProtection: policy.civilianProtection,
        treatyExemptions: policy.treatyExemptions.join(","),
        redlist: policy.redlist.join(","),
        whitelist: policy.whitelist.join(","),
        expectedVersion,
      }));
    }
    void loadPolicy();
    return () => {
      disposed = true;
    };
  }, [policyId]);

  function buildPayload() {
    return {
      mode: state.mode,
      tollBase: Number(state.tollBase),
      riskMultiplier: Number(state.riskMultiplier),
      civilianProtection: state.civilianProtection,
      treatyExemptions: state.treatyExemptions.split(",").map((item: string) => item.trim()).filter(Boolean),
      redlist: state.redlist.split(",").map((item: string) => item.trim()).filter(Boolean),
      whitelist: state.whitelist.split(",").map((item: string) => item.trim()).filter(Boolean),
      expectedVersion: state.expectedVersion ?? undefined,
    };
  }

  function dryRun() {
    startTransition(async () => {
      const payload = buildPayload();
      const res = await fetch(`${API_BASE}/policies/${policyId}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as DryRunResponse | { errorCode?: string; message?: string };
      if (!res.ok) {
        setState((current) => ({
          ...current,
          status: `${(data as { errorCode?: string; message?: string }).errorCode ?? "DRY_RUN_FAILED"}: ${(data as { errorCode?: string; message?: string }).message ?? "Dry run failed."}`,
        }));
        return;
      }
      setState((current) => ({
        ...current,
        dryRun: data as DryRunResponse,
        expectedVersion: (data as DryRunResponse).expectedVersion,
        status: "Dry run computed. Review impact before apply.",
      }));
    });
  }

  function submit() {
    startTransition(async () => {
      const payload = buildPayload();

      const res = await fetch(`${API_BASE}/policies/${policyId}`, {
        method: "PUT",
        headers: buildWriteHeaders({
          actorAddress: "operator-alpha",
          roleBits: 1,
        }),
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { errorCode?: string; message?: string };

      if (!res.ok && data.errorCode === "POLICY_VERSION_CONFLICT") {
        const versionsRes = await fetch(`${API_BASE}/policies/${policyId}/versions`);
        const versionsData = (await versionsRes.json()) as { versions: Array<{ version: number }> };
        const latestVersion = versionsData.versions[0]?.version ?? null;
        setState((current) => ({
          ...current,
          expectedVersion: latestVersion,
          status: `POLICY_VERSION_CONFLICT: Detected concurrent update. Synced to latest version ${latestVersion}. Run dry-run and apply again.`,
        }));
        return;
      }

      setState((current) => ({
        ...current,
        status: res.ok
          ? "Policy updated with idempotent write headers."
          : `${data.errorCode ?? "POLICY_UPDATE_FAILED"}: ${data.message ?? "Policy update failed."}`,
      }));
    });
  }

  return (
    <div className="panel">
      <h3>Policy control</h3>
      <p className="muted">
        Includes dry-run impact, optimistic conflict detection, and version-aware writes.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Mode</span>
          <select
            value={state.mode}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setState((current) => ({ ...current, mode: event.target.value as PolicyMode }))
            }
          >
            <option value="ceasefire">Ceasefire</option>
            <option value="blockade">Blockade</option>
            <option value="wartime">Wartime</option>
          </select>
        </label>
        <label className="field">
          <span>Toll base</span>
          <input
            type="number"
            value={state.tollBase}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setState((current) => ({ ...current, tollBase: Number(event.target.value) }))
            }
          />
        </label>
        <label className="field">
          <span>Risk multiplier</span>
          <input
            type="number"
            step="0.1"
            value={state.riskMultiplier}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setState((current) => ({ ...current, riskMultiplier: Number(event.target.value) }))
            }
          />
        </label>
        <label className="field">
          <span>Treaty exemptions</span>
          <input
            value={state.treatyExemptions}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setState((current) => ({ ...current, treatyExemptions: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Redlist</span>
          <input
            value={state.redlist}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setState((current) => ({ ...current, redlist: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Whitelist</span>
          <input
            value={state.whitelist}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setState((current) => ({ ...current, whitelist: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={state.civilianProtection}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setState((current) => ({ ...current, civilianProtection: event.target.checked }))
              }
            />{" "}
            Civilian protection
          </span>
        </label>
        <p className="muted code">expectedVersion {state.expectedVersion ?? "n/a"}</p>
        <div className="overlay-actions">
          <button className="button secondary" onClick={dryRun} disabled={pending}>
            {pending ? "Running..." : "Dry-run impact"}
          </button>
          <button className="button" onClick={submit} disabled={pending}>
            {pending ? "Updating..." : "Apply live policy"}
          </button>
        </div>
        {state.dryRun ? (
          <div className="list-item">
            <strong>Dry-run impact</strong>
            <p className="muted code">
              tollDelta {state.dryRun.impact.tollDelta} | riskDeltaPct {state.dryRun.impact.riskDeltaPct}%
            </p>
            <p className="muted code">
              redlistDelta {state.dryRun.impact.redlistDelta} | whitelistDelta {state.dryRun.impact.whitelistDelta}
            </p>
            <p className="muted code">modeChanged {String(state.dryRun.impact.modeChanged)}</p>
          </div>
        ) : null}
        {state.status ? <p className="muted">{state.status}</p> : null}
      </div>
    </div>
  );
}
