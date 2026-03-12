"use client";

import { useEffect, useState } from "react";

import type { RoutePassRecord, RouteQuote } from "@aegis-mesh/shared";

import { buildWriteHeaders } from "./api";
import { useDappKitBridge } from "./dapp-kit-adapter";
import { AegisEveFrontierProvider } from "./eve-frontier-provider";
import { useGameBridge } from "./game-bridge";
import { WalletConnectionCard } from "./wallet-connection-card";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type OverlayState = "idle" | "range" | "distress" | "success";

type LiveStatus = {
  dataSource: "official_live" | "simulated" | "stale";
  hasOfficialBinding: boolean;
  liveStatus?: {
    lastSnapshot?: {
      sourceSnapshotId: string;
    } | null;
  };
};

function OverlayConsoleInner() {
  const bridge = useGameBridge();
  const wallet = useDappKitBridge();
  const [state, setState] = useState<OverlayState>("idle");
  const [status, setStatus] = useState("Waiting for in-game trigger.");
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [activeSystem, setActiveSystem] = useState("stillness-alpha-7");
  const [activeGate, setActiveGate] = useState("gate-alpha-7");
  const [characterId, setCharacterId] = useState("pilot-blue-01");
  const [activeCorrelationId, setActiveCorrelationId] = useState<string | undefined>(undefined);
  const [latestIncidentId, setLatestIncidentId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({
    dataSource: "simulated",
    hasOfficialBinding: false,
  });

  useEffect(() => {
    void fetch(`${API_BASE}/live/status`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: LiveStatus) => setLiveStatus(data))
      .catch(() =>
        setLiveStatus({
          dataSource: "stale",
          hasOfficialBinding: false,
        }),
      );
  }, []);

  useEffect(() => {
    const latest = bridge.events[0];
    if (!latest) {
      return;
    }

    if (latest.type === "PLAYER_ENTERED_RANGE") {
      setState("range");
      setCharacterId(latest.payload.characterId);
      setActiveCorrelationId(latest.correlationId);
      setActiveSystem(latest.payload.solarSystemId);
      setActiveGate(latest.payload.gateId);
      setStatus(`Overlay opened for ${latest.payload.solarSystemId} at ${latest.payload.distance}m.`);
      const snapshotHint = liveStatus.liveStatus?.lastSnapshot?.sourceSnapshotId ?? `overlay-snapshot-${Date.now()}`;
      void fetch(
        `${API_BASE}/route/quote?from=${latest.payload.solarSystemId}&to=trade-hub-iv&mode=safe&sourceSnapshotId=${encodeURIComponent(snapshotHint)}`,
      )
        .then((res) => res.json())
        .then((data: RouteQuote) => setQuote(data));
      bridge.emitToGame({
        source: "aegis-mesh",
        type: "OVERLAY_OPENED",
        payload: {
          mode: bridge.hasBridge ? "live" : "sim",
          panelType: "route",
        },
        timestamp: Date.now(),
        correlationId: latest.correlationId,
      });
    }

    if (latest.type === "DISTRESS_SHORTCUT") {
      setState("distress");
      setCharacterId(latest.payload.characterId);
      setActiveCorrelationId(latest.correlationId);
      setActiveSystem(latest.payload.solarSystemId);
      setStatus(`Distress shortcut raised from ${latest.payload.solarSystemId}.`);
    }

    if (latest.type === "PLAYER_LEFT_RANGE") {
      setState("idle");
      setActiveCorrelationId(latest.correlationId);
      setStatus("Player left range. Overlay hidden.");
      setQuote(null);
    }
  }, [bridge.events, bridge.hasBridge, liveStatus.liveStatus?.lastSnapshot?.sourceSnapshotId]);

  useEffect(() => {
    const wsBase = API_BASE.replace("http://", "ws://").replace("https://", "wss://");
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (closed) {
        return;
      }
      socket = new WebSocket(`${wsBase}/intel-stream`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as {
            channel?: string;
            headline?: string;
            summary?: string;
          };
          if (message.channel !== "intel.claims") {
            return;
          }
          if (!message.headline?.includes("Auditor approved")) {
            return;
          }
          const incidentId = message.headline.split(" ").pop() ?? "incident-unknown";
          setLatestIncidentId(incidentId);
          bridge.emitToGame({
            source: "aegis-mesh",
            type: "INCIDENT_READY",
            payload: { incidentId, beaconId: "beacon-unknown", status: "AUDITOR_APPROVED" },
            timestamp: Date.now(),
          });
        } catch {
          // ignore malformed stream messages
        }
      };
      socket.onopen = () => {
        retryCount = 0;
      };
      socket.onclose = () => {
        if (closed) {
          return;
        }
        const backoff = Math.min(5_000, 500 * 2 ** retryCount);
        retryCount += 1;
        reconnectTimer = setTimeout(connect, backoff);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  async function waitForRoutePassConfirmation(routePassId: string): Promise<RoutePassRecord | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await fetch(`${API_BASE}/route/pass/${routePassId}`, { cache: "no-store" });
      if (!res.ok) {
        return null;
      }
      const pass = (await res.json()) as RoutePassRecord;
      if (pass.consumed || pass.status === "failed") {
        return pass;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return null;
  }

  async function requestRoutePass(provider: "custom" | "dapp-kit") {
    if (liveStatus.dataSource === "stale") {
      setStatus("Live data is stale. Sponsor action is disabled for evidence safety.");
      return;
    }
    if (provider === "dapp-kit" && !wallet.isConnected) {
      wallet.handleConnect();
      setStatus("Wallet wake-up requested. Approve EVE Vault connection, then retry route sponsorship.");
      return;
    }

    const actorAddress = wallet.walletAddress ?? characterId;

    const res = await fetch(`${API_BASE}/sponsor/route`, {
      method: "POST",
      headers: buildWriteHeaders({ actorAddress }),
      body: JSON.stringify({
        from: activeSystem,
        to: "trade-hub-iv",
        mode: "safe",
        characterId,
        allianceId: "alliance-alpha",
        sourceGateId: activeGate,
        destinationGateId: "gate-beta-3",
        locationProof: "simulated-location-proof",
        sponsorProvider: provider,
      }),
    });

    const data = (await res.json()) as {
      routePassId?: string;
      sponsorDigest?: string | null;
      status?: string;
      requiresClientExecution?: boolean;
      dappKitPayload?: {
        method: "signAndExecuteBridgeTransaction";
        configured: boolean;
        target: string | null;
        packageId: string | null;
        serverRegistryId: string | null;
        clockObjectId: string;
        sourceGateId: string;
        destinationGateId: string;
        characterObjectId: string;
        locationProof: string | null;
        expiresAtMs: number;
        routePassId: string;
        sourceSnapshotId: string;
      } | null;
      quote?: RouteQuote;
      errorCode?: string;
      message?: string;
    };

    if (!res.ok || !data.routePassId || !data.quote) {
      setStatus(data.message ?? data.errorCode ?? "Route pass request failed.");
      return;
    }

    if (provider === "dapp-kit" && data.requiresClientExecution && !data.sponsorDigest) {
      if (!data.dappKitPayload) {
        setStatus("dapp-kit payload is missing.");
        return;
      }
      setQuote(data.quote);
      setState("range");
      setStatus(
        data.dappKitPayload.configured
          ? `Wallet connected and bridge payload prepared for ${data.dappKitPayload.target}. Execute this step in the live EVE Vault flow and then submit the resulting digest back to Aegis Mesh.`
          : "Wallet is connected, but live bridge package IDs are not configured yet. Set Stillness package IDs before using the official wallet path.",
      );
      return;
    }

    const permitDigest = data.sponsorDigest ?? "0xdeadbeef";
    await fetch(`${API_BASE}/route/pass/consume`, {
      method: "POST",
      headers: buildWriteHeaders({ actorAddress }),
      body: JSON.stringify({
        routePassId: data.routePassId,
        allianceId: "alliance-alpha",
        permitDigest,
      }),
    });

    setQuote(data.quote);
    setState("success");
    const confirmedPass = await waitForRoutePassConfirmation(data.routePassId);
    if (confirmedPass?.consumed) {
      setStatus(`Route pass confirmed on-chain: ${confirmedPass.linkedPermitDigest ?? permitDigest}`);
      bridge.emitToGame({
        source: "aegis-mesh",
        type: "ROUTE_PASS_SUCCESS",
        payload: {
          passId: data.routePassId,
          txDigest: confirmedPass.linkedPermitDigest ?? permitDigest,
          sourceGateId: activeGate,
          destGateId: "gate-beta-3",
          quotedCost: data.quote.estimatedCost,
        },
        timestamp: Date.now(),
        correlationId: activeCorrelationId,
      });
      return;
    }
    if (confirmedPass?.status === "failed") {
      setStatus(`Route pass submitted, but chain confirmation failed: ${confirmedPass.confirmationError ?? "unknown error"}`);
      return;
    }
    setStatus(`Permit digest submitted: ${permitDigest}. Waiting for indexer confirmation.`);
  }

  async function raiseDistress() {
    if (liveStatus.dataSource === "stale") {
      setStatus("Live data is stale. Distress submit is disabled for evidence safety.");
      return;
    }

    const res = await fetch(`${API_BASE}/distress`, {
      method: "POST",
      headers: buildWriteHeaders({ actorAddress: wallet.walletAddress ?? characterId }),
      body: JSON.stringify({
        allianceId: "alliance-alpha",
        characterId,
        systemId: activeSystem,
        threatLevel: "high",
        bondAmount: 5,
        locationProof: "simulated-location-proof",
      }),
    });

    const data = (await res.json()) as {
      beaconId?: string;
      chainDigest?: string | null;
      errorCode?: string;
      message?: string;
    };

    if (!res.ok || !data.beaconId) {
      setStatus(data.message ?? data.errorCode ?? "Distress submit failed.");
      return;
    }

    setState("success");
    setStatus(`Distress beacon submitted: ${data.beaconId}`);
    bridge.emitToGame({
      source: "aegis-mesh",
      type: "DISTRESS_SUBMITTED",
      payload: {
        beaconId: data.beaconId,
        characterId,
        systemId: activeSystem,
        txDigest: data.chainDigest ?? undefined,
      },
      timestamp: Date.now(),
      correlationId: activeCorrelationId,
    });
  }

  const runMode = bridge.hasBridge ? "live" : "sim";

  return (
    <main className="overlay-page">
      <section className="overlay-shell">
        <div className="split mb-8">
          <span className="badge">In-Game Overlay</span>
          <span className="badge" data-tone={liveStatus.dataSource === "official_live" ? "good" : "danger"}>
            {runMode.toUpperCase()} / {liveStatus.dataSource}
          </span>
        </div>
        <h2>Aegis Field Panel</h2>
        <p className="muted">{status}</p>

        {quote ? (
          <div className="panel panel-tight mb-14">
            <div className="split">
              <strong>{quote.mode.toUpperCase()} route</strong>
              <span className="badge" data-tone="good">
                score {quote.score}
              </span>
            </div>
            <p className="muted">{quote.summary}</p>
            <p className="muted code">snapshot {quote.sourceSnapshotId} / freshness {quote.dataFreshnessMs}ms</p>
            <div className="list">
              {quote.hops.map((hop: RouteQuote["hops"][number]) => (
                <div key={hop.nodeId} className="list-item">
                  <strong>{hop.label}</strong>
                  <span className="muted code">
                    {hop.systemId} risk {hop.risk} toll {hop.toll}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <WalletConnectionCard />

        <div className="overlay-actions">
          <button className="button" onClick={() => void requestRoutePass("dapp-kit")} disabled={state === "idle"}>
            View risk and buy route pass
          </button>
          <button className="button secondary" onClick={() => void requestRoutePass("custom")} disabled={state === "idle"}>
            Buy custom sponsored route
          </button>
          <button className="button warn" onClick={() => void raiseDistress()}>
            Raise distress
          </button>
        </div>

        <div className="panel panel-tight mt-14">
          <strong>Simulator</strong>
          <p className="muted">
            Use these buttons when the game client bridge is unavailable. Sim mode is dev-only evidence.
          </p>
          <div className="overlay-actions">
            <button className="button secondary" onClick={bridge.simulateEnterRange}>
              Simulate gate proximity
            </button>
            <button className="button secondary" onClick={bridge.simulateDistress}>
              Simulate distress shortcut
            </button>
          </div>
        </div>

        <div className="panel panel-tight mt-14">
          <strong>Latest bridge events</strong>
          {latestIncidentId ? <p className="muted code">INCIDENT_READY emitted for {latestIncidentId}</p> : null}
          <div className="list">
            {bridge.events.slice(0, 4).map((event, index: number) => (
              <div key={`${event.type}-${index}`} className="list-item">
                <strong>{event.type}</strong>
                <span className="muted code">{JSON.stringify(event.payload)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export function OverlayConsole() {
  return (
    <AegisEveFrontierProvider>
      <OverlayConsoleInner />
    </AegisEveFrontierProvider>
  );
}
