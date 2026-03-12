# Aegis Mesh Architecture

## 1. North Star

`Aegis Mesh` is designed as a civilization infrastructure toolkit for EVE Frontier:

1. Safe passage and convoy sponsorship.
2. Distress intake, response, and incident settlement.
3. Policy governance for gates, turrets, and logistics nodes.
4. Real-time operations visibility for browser and in-game overlay.

## 2. Current Architecture

1. `contracts/aegis_mesh`
- Move protocol object model for node registration, policy updates, route passes,
  distress beacons, and incident resolution.

2. `apps/api`
- Express service for HTTP actions and a WebSocket intel stream.
- Current implementation includes route quote, sponsor route, distress intake,
  incident attachment, policy write, and intel broadcast.

3. `apps/web`
- Next.js dual surface:
- `/ops`: operations console for alliance operators.
- `/overlay`: game-embedded interaction panel via postMessage bridge.

4. `packages/shared`
- Shared types and mock projection helpers used by API and Web.

## 3. Target Architecture (Competition Grade)

### 3.1 Protocol Layer

1. Multi-tenant object isolation with explicit tenant key.
2. Role-based ACL expansion from single operator to multi-role governance.
3. Event-first design for indexers and observability.
4. Version-safe policy evolution and rollback support.

### 3.2 Service Layer

Split backend responsibilities into clear domains:

1. `gateway-api`
- Public API edge, request validation, auth, and idempotency.

2. `sponsor-service`
- Sponsored transaction orchestration and risk checks.

3. `indexer-service`
- Event ingestion from chain + query model persistence.

4. `realtime-service`
- WebSocket/SSE fanout with reconnect and sequence support.

### 3.3 Experience Layer

1. `ops` surface
- Policy control, incident review, payout visibility, alliance health.

2. `overlay` surface
- Contextual actions from game events: quote, sponsor, distress, status feed.

3. `live/sim dual mode`
- Explicit mode indicator to avoid demo ambiguity.

## 4. Core Execution Loops

### 4.1 Route Sponsorship

`PLAYER_ENTERED_RANGE -> /route/quote -> /sponsor/route -> RoutePassIssued -> ROUTE_PASS_SUCCESS`

### 4.2 Emergency Response

`DISTRESS_SHORTCUT -> /distress -> DistressRaised -> responder acceptance -> resolve incident -> payout`

### 4.3 Policy Governance

`ops editor -> PUT /policies/:id -> PolicyUpdated -> intel broadcast -> overlay awareness`

## 5. Data Ownership

1. On-chain
- Final state, policy truth, route pass truth, payout truth.

2. Off-chain
- Query projections, operational dashboards, performance analytics.

3. Evidence
- Hash-on-chain, payload-off-chain pattern for scalable incident evidence.

## 6. Reliability And Security Baseline

1. Must-have controls
- Request idempotency on write endpoints.
- Authentication for operator-level endpoints.
- Rate limiting for distress and sponsor actions.

2. Must-have observability
- Request success rate, P95 latency, intel stream health, sponsor success rate.

3. Must-have recovery
- Graceful fallback from live mode to sim mode for demo continuity.

## 7. Gap Closure Map

1. Already strong
- End-to-end prototype loops and dual-surface UX.
- Coherent Move/API/Web layering.

2. Immediate upgrades
- Replace mock-first service paths with chain + indexer backed reads.
- Add sponsor risk checks and stable error code mapping.
- Add live integration proof package (hashes, logs, demo script).

3. Strategic upgrades
- Treaty and insurance modules to expand from utility tool to civilization OS.

## 8. Spec References

Detailed implementation specs are in:

1. `specs/01-protocol-design.md`
2. `specs/02-api-contract.md`
3. `specs/03-route-sponsorship.md`
4. `specs/04-distress-incident.md`
5. `specs/05-policy-framework.md`
6. `specs/06-overlay-live-integration.md`
7. `specs/07-security-observability.md`
8. `specs/08-roadmap-delivery.md`
