import {
  fetchBeacons,
  fetchIncidents,
  fetchIndexerStatus,
  fetchIntel,
  fetchLiveStatus,
  fetchNodes,
  fetchRouteQuote,
} from "./api";
import { PolicyEditor } from "./policy-editor";

export async function OpsConsole() {
  const [nodes, incidents, beacons, intel, safeRoute, live, indexer] = await Promise.all([
    fetchNodes(),
    fetchIncidents(),
    fetchBeacons(),
    fetchIntel(),
    fetchRouteQuote("safe"),
    fetchLiveStatus(),
    fetchIndexerStatus(),
  ]);

  return (
    <main className="page">
      <section className="hero">
        <div className="panel">
          <div className="split mb-8">
            <span className="badge">Border Governance</span>
            <span className="badge" data-tone={live.dataSource === "official_live" ? "good" : "danger"}>
              {live.dataSource}
            </span>
          </div>
          <h1>Alliance safety and convoy operations in one control surface.</h1>
          <p className="muted">
            Aegis Mesh fuses route intelligence, node policies, distress dispatch,
            and incident review into a single operator loop.
          </p>
          <div className="grid three">
            <div className="stat">
              <span className="muted">Registered nodes</span>
              <strong className="stat-value">{nodes.length}</strong>
            </div>
            <div className="stat">
              <span className="muted">Open distress beacons</span>
              <strong className="stat-value">{beacons.filter((b) => b.status !== "resolved").length}</strong>
            </div>
            <div className="stat">
              <span className="muted">Pending incident cases</span>
              <strong className="stat-value">{incidents.filter((incident) => incident.verdict === "pending").length}</strong>
            </div>
          </div>
        </div>
        <div className="panel">
          <span className="badge" data-tone="good">
            Recommended
          </span>
          <h3>Safe convoy profile</h3>
          <p className="muted">{safeRoute.summary}</p>
          <p className="muted code">snapshot {safeRoute.sourceSnapshotId}</p>
          <div className="list">
            <div className="split">
              <span className="muted">Score</span>
              <strong className="code">{safeRoute.score}</strong>
            </div>
            <div className="split">
              <span className="muted">Estimated risk</span>
              <strong className="code">{safeRoute.estimatedRisk}</strong>
            </div>
            <div className="split">
              <span className="muted">Estimated cost</span>
              <strong className="code">{safeRoute.estimatedCost} SUI</strong>
            </div>
            <div className="split">
              <span className="muted">Data freshness</span>
              <strong className="code">{safeRoute.dataFreshnessMs}ms</strong>
            </div>
            <div className="split">
              <span className="muted">Indexer events</span>
              <strong className="code">{indexer.indexer.totalEvents}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <h3>Registered nodes</h3>
          <div className="list">
            {nodes.map((node) => (
              <div key={node.nodeId} className="list-item">
                <div className="split">
                  <strong>{node.label}</strong>
                  <span className="badge">{node.kind}</span>
                </div>
                <p className="muted">
                  {node.systemId} policy <span className="code">{node.policyId}</span>
                </p>
                <p className="muted">
                  Mode: {node.policy?.mode ?? "unknown"} Toll {node.policy?.tollBase ?? "--"}
                  Risk x{node.policy?.riskMultiplier.toFixed(2) ?? "--"}
                </p>
              </div>
            ))}
          </div>
        </div>

        <PolicyEditor policyId={nodes[0]?.policyId ?? "policy-border-west"} />
      </section>

      <section className="grid two mt-18">
        <div className="panel">
          <h3>Distress queue</h3>
          <div className="list">
            {beacons.map((beacon) => (
              <div key={beacon.beaconId} className="list-item">
                <div className="split">
                  <strong>{beacon.characterId}</strong>
                  <span className="badge" data-tone={beacon.threatLevel === "critical" ? "danger" : "good"}>
                    {beacon.threatLevel}
                  </span>
                </div>
                <p className="muted code">
                  {beacon.systemId} {beacon.status} {beacon.sourceSnapshotId}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Incident cases</h3>
          <div className="list">
            {incidents.map((incident) => (
              <div key={incident.incidentId} className="list-item">
                <div className="split">
                  <strong>{incident.title}</strong>
                  <span className="badge">{incident.verdict}</span>
                </div>
                <p className="muted">{incident.summary}</p>
                <p className="muted code">
                  {incident.killmailRef ?? "No killmail yet"} evidence {incident.evidenceCount}
                </p>
                <p className="muted code">
                  digest {incident.chainDigest ?? "n/a"} eventSeq {incident.chainEventSeq ?? "n/a"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel mt-18">
        <h3>Live Universe Binding</h3>
        <div className="list">
          <div className="list-item">
            <strong>RPC / GraphQL health</strong>
            <p className="muted code">
              configuredMode {live.configuredMode ?? "n/a"} / runtimeSource {live.dataSource}
            </p>
            <p className="muted code">
              rpc {String(live.liveStatus?.rpcHealthy ?? false)} / gql {String(live.liveStatus?.graphqlHealthy ?? false)} / grpc{" "}
              {String(live.liveStatus?.grpcHealthy ?? false)}
            </p>
            <p className="muted code">
              snapshot {live.liveStatus?.lastSnapshot?.sourceSnapshotId ?? "n/a"} block {live.liveStatus?.lastSnapshot?.blockHeight ?? "n/a"}
            </p>
            <p className="muted code">lastGrpcEventSeq {live.liveStatus?.lastGrpcEventSeq ?? "n/a"}</p>
            <p className="muted code">lastError {live.liveStatus?.lastError ?? "none"}</p>
            <p className="muted code">
              grpcStream enabled {String(live.grpcStream?.enabled ?? false)} running {String(live.grpcStream?.running ?? false)} events{" "}
              {live.grpcStream?.totalEvents ?? 0}
            </p>
          </div>
          <div className="list-item">
            <strong>Indexer status</strong>
            <p className="muted code">
              enabled {String(indexer.indexer.enabled)} running {String(indexer.indexer.running)} poll {indexer.indexer.pollIntervalMs}ms
            </p>
            <p className="muted code">
              totalEvents {indexer.indexer.totalEvents} lastPoll {indexer.indexer.lastPollAt ?? "n/a"}
            </p>
            <p className="muted code">lastCursor {indexer.indexer.lastCursor?.txDigest ?? "n/a"}</p>
          </div>
        </div>
      </section>

      <section className="panel mt-18">
        <h3>Agent suggestions</h3>
        <div className="list">
          {intel.map((message) => (
            <div key={message.id} className="list-item">
              <div className="split">
                <strong>{message.headline}</strong>
                <span className="badge">{message.kind}</span>
              </div>
              <p className="muted">{message.summary}</p>
              <p className="muted code">
                {message.channel} seq {message.sequence} {message.dataSource}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
