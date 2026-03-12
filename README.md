# Aegis Mesh

`Aegis Mesh` is a multi-layer safety and governance stack for EVE Frontier.

It is built as a civilization toolkit covering:

1. Route risk estimation and sponsored passage.
2. Distress intake, response coordination, and incident settlement.
3. Policy governance for alliance infrastructure.
4. Real-time operations awareness for browser and in-game overlay.

## Why This Project

Frontier is a programmable world where infrastructure is gameplay. Aegis Mesh focuses on the core survival loop:

1. Move safely.
2. Call for help quickly.
3. Resolve disputes transparently.
4. Keep alliance policy adaptive in real time.

## Current Scope

1. Move protocol package (`contracts/aegis_mesh`).
2. TypeScript API with HTTP + WebSocket (`apps/api`).
3. Next.js dual-surface app (`apps/web`).
4. Shared types and mock helpers (`packages/shared`).

## Workspace Layout

1. `contracts/aegis_mesh`
- Protocol object model, events, and tests.

2. `apps/api`
- API endpoints:
- route quote and sponsorship
- distress and incident operations
- policy proposal/approval/rollback/dry-run
- intel stream (`/intel-stream`)
- live binding + indexer status + metrics

3. `apps/web`
- `/ops`: alliance operations console.
- `/overlay`: in-game interaction panel.

4. `packages/shared`
- Shared type contracts and mock projection helpers.

## Demo Loops

1. Route sponsorship
- `PLAYER_ENTERED_RANGE -> /route/quote -> /sponsor/route -> ROUTE_PASS_SUCCESS`

2. Emergency response
- `DISTRESS_SHORTCUT -> /distress -> incident attachment -> intel broadcast`

3. Policy reconfiguration
- `ops policy editor -> PUT /policies/:id -> live intel update`

## Quick Start

```bash
npm install
npm run dev:api
npm run dev:web
```

## Test And Quality Checks

```bash
npm run test:all
npm run typecheck
npm run lint
npm run build
npm run check:all
```

## Stillness Evidence Export

```bash
npm run evidence:stillness
npm run evidence:verify-digests
```

Default API base is `http://localhost:4000`. Set `AEGIS_API_BASE_URL` to point at a live API instance.

## Move Tests

```bash
cd contracts/aegis_mesh
sui move test
```

## Architecture Docs

1. `docs/architecture.md`
- End-to-end architecture and upgrade map.

2. `specs/README.md`
- Full specification index for protocol, API, overlay, security, and roadmap.

3. `docs/FINAL_CLOSURE_TUTORIAL_CN.md`
- Final Stillness configuration and live-evidence closure guide (Chinese).

4. `docs/HACKATHON_STATUS_REPORT_CN.md`
- Current project status, sprint findings, prize-readiness analysis, and next actions.

5. `docs/PERSONAL_ACTION_RUNBOOK_CN.md`
- The checklist of actions that must be completed by you personally for final submission.

## New Specs Directory

Detailed project specs are now provided in `specs/`:

1. `specs/01-protocol-design.md`
2. `specs/02-api-contract.md`
3. `specs/03-route-sponsorship.md`
4. `specs/04-distress-incident.md`
5. `specs/05-policy-framework.md`
6. `specs/06-overlay-live-integration.md`
7. `specs/07-security-observability.md`
8. `specs/08-roadmap-delivery.md`

## Competition Upgrade Priorities

1. Replace mock-first reads with chain + indexer backed projections.
2. Implement sponsor-service hardening: idempotency, auth, rate limiting.
3. Produce live integration evidence package: logs, tx hashes, end-to-end video.
4. Add treaty and insurance extension modules to increase strategic depth.

## Live Integration Evidence Checklist

1. Live overlay connection log.
2. At least 3 on-chain transaction hashes for critical flows.
3. 5-minute end-to-end demo script and recording.
4. Screenshots from in-game overlay and ops console under the same scenario.

## Contribution Notes

1. Keep shared type contracts in `packages/shared` as the single source of truth.
2. Update corresponding spec files when API or protocol behavior changes.
3. Preserve event names and payload compatibility for indexers and dashboards.
