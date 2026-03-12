# Aegis Mesh World Integration Template

This folder is a deployment template for integrating Aegis Mesh with official EVE Frontier world contracts.

It is not part of the default local test package. Use it when you are ready to connect to Stillness.

## Why this template exists

- Local `contracts/aegis_mesh` keeps fast unit tests independent from external package IDs.
- Stillness deployment requires real `world-contracts` package IDs and a fixed commit hash.
- Official proximity verification lives in `world::location`, so the live bridge is the correct place to call it before distress/jump operations.

## Steps

1. Copy `Move.toml.template` to `Move.toml`.
2. Fill `world` and `aegis_mesh` addresses with your deployed package IDs.
3. Confirm the pinned `world-contracts` commit matches the Stillness environment.
4. Rename `sources/aegis_world_bridge.move.template` to `aegis_world_bridge.move`.
5. Build and publish from this directory.

## Validation target

- `authorize_extension<AegisMeshAuth>()` succeeds on target Gate.
- `issue_jump_permit_with_location_proof()` verifies `world::location::verify_proximity_proof_from_bytes()` before calling official `gate::issue_jump_permit`.
- `raise_distress_with_location_proof()` verifies the same official proximity proof and stores a hash of the proof in the Aegis Mesh registry.
- Transaction digest can be traced from API audit logs and explorer.
