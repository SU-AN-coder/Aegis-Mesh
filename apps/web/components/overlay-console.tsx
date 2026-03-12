"use client";

import { useEffect, useState } from "react";

import type { RouteQuote } from "@aegis-mesh/shared";

import { buildWriteHeaders } from "./api";
import { executeSponsoredWithDappKit } from "./dapp-kit-adapter";
import { useGameBridge } from "./game-bridge";

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

export function OverlayConsole() {
  const bridge = useGameBridge();
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

  async function requestRoutePass(provider: "custom" | "dapp-kit") {
    if (liveStatus.dataSource === "stale") {
      setStatus("Live data is stale. Sponsor action is disabled for evidence safety.");
      return;
    }

    const res = await fetch(`${API_BASE}/sponsor/route`, {
      method: "POST",
      headers: buildWriteHeaders({ actorAddress: characterId }),
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
        method: "signAndExecuteSponsoredTransaction";
        moveCall: {
          target: string;
          arguments: Record<string, string | number | boolean>;
        };
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

      try {
        const receipt = await executeSponsoredWithDappKit(data.dappKitPayload);
        await fetch(`${API_BASE}/route/pass/consume`, {
          method: "POST",
          headers: buildWriteHeaders({ actorAddress: characterId }),
          body: JSON.stringify({
            routePassId: data.routePassId,
            allianceId: "alliance-alpha",
            permitDigest: receipt.digest,
          }),
        });
        setQuote(data.quote);
        setState("success");
        setStatus(`dapp-kit jump permit executed: ${receipt.digest}`);
        bridge.emitToGame({
          source: "aegis-mesh",
          type: "ROUTE_PASS_SUCCESS",
          payload: {
            passId: data.routePassId,
            txDigest: receipt.digest,
            sourceGateId: activeGate,
            destGateId: "gate-beta-3",
            quotedCost: data.quote.estimatedCost,
          },
          timestamp: Date.now(),
          correlationId: activeCorrelationId,
        });
        return;
      } catch {
        setQuote(data.quote);
        setState("range");
        setStatus(`Route pass prepared: ${data.routePassId}. Install/connect dapp-kit wallet context to execute.`);
        return;
      }
    }

    const permitDigest = data.sponsorDigest ?? "0xdeadbeef";
    await fetch(`${API_BASE}/route/pass/consume`, {
      method: "POST",
      headers: buildWriteHeaders({ actorAddress: characterId }),
      body: JSON.stringify({
        routePassId: data.routePassId,
        allianceId: "alliance-alpha",
        permitDigest,
      }),
    });

    setQuote(data.quote);
    setState("success");
    setStatus(`Route pass ready: ${data.routePassId} (${provider}).`);
    bridge.emitToGame({
      source: "aegis-mesh",
      type: "ROUTE_PASS_SUCCESS",
      payload: {
        passId: data.routePassId,
        txDigest: permitDigest,
        sourceGateId: activeGate,
        destGateId: "gate-beta-3",
        quotedCost: data.quote.estimatedCost,
      },
      timestamp: Date.now(),
      correlationId: activeCorrelationId,
    });
  }

  async function raiseDistress() {
    if (liveStatus.dataSource === "stale") {
      setStatus("Live data is stale. Distress submit is disabled for evidence safety.");
      return;
    }

    const res = await fetch(`${API_BASE}/distress`, {
      method: "POST",
      headers: buildWriteHeaders({ actorAddress: characterId }),
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
