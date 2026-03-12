create table if not exists nodes (
  node_id text primary key,
  alliance_id text not null,
  kind text not null,
  label text not null,
  system_id text not null,
  assembly_id text not null,
  policy_id text not null,
  updated_at timestamptz not null default now()
);

create table if not exists incidents (
  incident_id text primary key,
  alliance_id text not null,
  beacon_id text,
  killmail_ref text,
  verdict text not null,
  title text not null,
  summary text not null,
  evidence_count integer not null default 0,
  chain_digest text,
  chain_event_seq text,
  source_snapshot_id text,
  source_event_from bigint,
  source_event_to bigint,
  updated_at timestamptz not null default now()
);

create table if not exists beacons (
  beacon_id text primary key,
  alliance_id text not null,
  character_id text not null,
  system_id text not null,
  threat_level text not null,
  bond_amount bigint not null default 0,
  status text not null,
  source_snapshot_id text,
  chain_digest text,
  opened_at timestamptz not null default now()
);

create table if not exists route_passes (
  route_pass_id text primary key,
  alliance_id text not null,
  character_id text not null,
  source_gate_id text not null,
  destination_gate_id text not null,
  route_fingerprint text not null,
  sponsor_provider text not null,
  quoted_cost bigint not null,
  quoted_risk bigint not null,
  source_snapshot_id text not null,
  permit_expires_at_ms bigint not null,
  linked_permit_digest text,
  consumed boolean not null default false,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists audit_log (
  request_id text primary key,
  endpoint text not null,
  actor text not null,
  role_bits bigint not null,
  alliance_id text not null,
  idempotency_key text not null,
  source_snapshot_id text not null,
  result text not null,
  tx_digest text,
  created_at timestamptz not null default now()
);
