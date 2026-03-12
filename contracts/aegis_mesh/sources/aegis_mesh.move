module aegis_mesh::aegis_mesh;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use sui::table::{Self, Table};
use sui::vec_map::{Self, VecMap};

const NODE_GATE: u8 = 0;
const NODE_TURRET: u8 = 1;
const NODE_STORAGE: u8 = 2;

const MODE_CEASEFIRE: u8 = 0;
const MODE_BLOCKADE: u8 = 1;
const MODE_WARTIME: u8 = 2;

const INCIDENT_PENDING: u8 = 0;
const INCIDENT_CONFIRMED: u8 = 1;
const INCIDENT_REJECTED: u8 = 2;

const BEACON_OPEN: u8 = 0;
const BEACON_CLAIMED: u8 = 1;

const ROLE_OPERATOR: u64 = 1;
const ROLE_AUDITOR: u64 = 2;
const ROLE_INSURER: u64 = 4;
const ROLE_TREATY_ADMIN: u64 = 8;

const E_NOT_AUTHORIZED: u64 = 0;
const E_NODE_EXISTS: u64 = 1;
const E_NODE_NOT_FOUND: u64 = 2;
const E_POLICY_NOT_FOUND: u64 = 3;
const E_BEACON_NOT_FOUND: u64 = 4;
const E_BEACON_NOT_OPEN: u64 = 5;
const E_RESPONDER_EXISTS: u64 = 6;
const E_INCIDENT_EXISTS: u64 = 7;
const E_INVALID_NODE_KIND: u64 = 8;
const E_INVALID_MODE: u64 = 9;
const E_ROUTE_ALREADY_EXISTS: u64 = 10;
const E_INVALID_VERDICT: u64 = 11;
const E_PAYOUT_MISMATCH: u64 = 12;
const E_ALLIANCE_EXISTS: u64 = 13;
const E_BEACON_EXISTS: u64 = 14;
const E_ROUTE_NOT_FOUND: u64 = 15;
const E_POLICY_VERSION_NOT_FOUND: u64 = 16;

const POLICY_HISTORY_LIMIT: u64 = 20;

public struct MeshAdminCap has key, store {
    id: UID,
}

public struct MeshRegistry has key {
    id: UID,
    version: u64,
    alliances: Table<ID, ID>,
}

public struct AllianceRegistry has key {
    id: UID,
    alliance_id: ID,
    owner: address,
    role_bits: Table<address, u64>,
    nodes: Table<ID, NodeRegistration>,
    policies: Table<ID, PolicyProfile>,
    policy_histories: Table<ID, PolicyHistory>,
    route_passes: Table<ID, RoutePass>,
    distress_beacons: Table<ID, DistressBeacon>,
    incidents: Table<ID, IncidentCase>,
}

public struct NodeRegistration has store {
    assembly_id: ID,
    owner: address,
    node_kind: u8,
    label: String,
    position_hash: vector<u8>,
    policy_id: ID,
    updated_at_ms: u64,
}

public struct PolicyProfile has copy, drop, store {
    mode: u8,
    toll_base: u64,
    risk_multiplier_bps: u64,
    civilian_protection: bool,
    treaty_exemptions: vector<ID>,
    redlist: vector<address>,
    whitelist: vector<address>,
}

public struct PolicySnapshot has copy, drop, store {
    version: u64,
    profile: PolicyProfile,
    changed_by: address,
    changed_at_ms: u64,
    reason: vector<u8>,
}

public struct PolicyHistory has store {
    current_version: u64,
    snapshots: vector<PolicySnapshot>,
}

public struct RoutePass has store {
    character_id: ID,
    route_fingerprint: vector<u8>,
    source_snapshot_id: vector<u8>,
    quoted_risk: u64,
    quoted_cost: u64,
    sponsor_scope: u8,
    sponsor: address,
    issued_at_ms: u64,
    expires_at_ms: u64,
    consumed: bool,
    linked_permit_digest: option::Option<vector<u8>>,
}

public struct DistressBeacon has store {
    character_id: ID,
    location_proof_hash: vector<u8>,
    status: u8,
    bond_value: u64,
    bond_pool: Balance<SUI>,
    responders: VecMap<address, ResponderBond>,
    opened_at_ms: u64,
}

public struct ResponderBond has store {
    responder: address,
    bond_value: u64,
    accepted_at_ms: u64,
}

public struct IncidentCase has store {
    beacon_id: option::Option<ID>,
    killmail_ref: option::Option<ID>,
    evidence_hashes: vector<vector<u8>>,
    verdict: u8,
    summary: String,
    payout_total: u64,
    resolved_at_ms: option::Option<u64>,
}

public struct AllianceRegistered has copy, drop {
    alliance_id: ID,
    registry_id: ID,
    owner: address,
}

public struct RoleGranted has copy, drop {
    alliance_id: ID,
    subject: address,
    role_bits: u64,
}

public struct RoleRevoked has copy, drop {
    alliance_id: ID,
    subject: address,
    role_bits: u64,
}

public struct NodeRegistered has copy, drop {
    alliance_id: ID,
    node_id: ID,
    node_kind: u8,
}

public struct PolicyUpdated has copy, drop {
    alliance_id: ID,
    node_id: ID,
    policy_id: ID,
    mode: u8,
}

public struct RoutePassIssued has copy, drop {
    alliance_id: ID,
    pass_id: ID,
    character_id: ID,
    quoted_risk: u64,
    quoted_cost: u64,
}

public struct DistressRaised has copy, drop {
    alliance_id: ID,
    beacon_id: ID,
    character_id: ID,
    bond_value: u64,
}

public struct ResponderAccepted has copy, drop {
    alliance_id: ID,
    beacon_id: ID,
    responder: address,
    bond_value: u64,
}

public struct KillmailLinked has copy, drop {
    alliance_id: ID,
    incident_id: ID,
    killmail_ref: ID,
}

public struct IncidentResolved has copy, drop {
    alliance_id: ID,
    incident_id: ID,
    verdict: u8,
    payout_total: u64,
}

public struct RewardPaid has copy, drop {
    alliance_id: ID,
    incident_id: ID,
    recipient: address,
    amount: u64,
}

fun init(ctx: &mut TxContext) {
    let admin = MeshAdminCap { id: object::new(ctx) };
    transfer::transfer(admin, tx_context::sender(ctx));
}

public fun create_registry(_admin: &MeshAdminCap, ctx: &mut TxContext) {
    let registry = MeshRegistry {
        id: object::new(ctx),
        version: 2,
        alliances: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun create_alliance_registry(
    _admin: &MeshAdminCap,
    registry: &mut MeshRegistry,
    alliance_id: ID,
    owner: address,
    ctx: &mut TxContext,
) {
    assert!(!table::contains(&registry.alliances, alliance_id), E_ALLIANCE_EXISTS);

    let mut alliance = AllianceRegistry {
        id: object::new(ctx),
        alliance_id,
        owner,
        role_bits: table::new(ctx),
        nodes: table::new(ctx),
        policies: table::new(ctx),
        policy_histories: table::new(ctx),
        route_passes: table::new(ctx),
        distress_beacons: table::new(ctx),
        incidents: table::new(ctx),
    };

    table::add(
        &mut alliance.role_bits,
        owner,
        ROLE_OPERATOR | ROLE_AUDITOR | ROLE_INSURER | ROLE_TREATY_ADMIN,
    );

    let alliance_registry_id = object::id(&alliance);
    table::add(&mut registry.alliances, alliance_id, alliance_registry_id);
    event::emit(AllianceRegistered {
        alliance_id,
        registry_id: alliance_registry_id,
        owner,
    });

    transfer::share_object(alliance);
}

public fun grant_role(
    alliance: &mut AllianceRegistry,
    subject: address,
    roles: u64,
    ctx: &TxContext,
) {
    assert_role_admin(alliance, ctx);

    if (table::contains(&alliance.role_bits, subject)) {
        let current_ref = table::borrow_mut(&mut alliance.role_bits, subject);
        *current_ref = *current_ref | roles;
    } else {
        table::add(&mut alliance.role_bits, subject, roles);
    };

    event::emit(RoleGranted {
        alliance_id: alliance.alliance_id,
        subject,
        role_bits: roles,
    });
}

public fun revoke_role(
    alliance: &mut AllianceRegistry,
    subject: address,
    roles: u64,
    ctx: &TxContext,
) {
    assert_role_admin(alliance, ctx);

    if (table::contains(&alliance.role_bits, subject)) {
        let current = *table::borrow(&alliance.role_bits, subject);
        let bits_to_clear = current & roles;
        let next = current ^ bits_to_clear;
        if (next == 0) {
            let _removed = table::remove(&mut alliance.role_bits, subject);
        } else {
            let current_ref = table::borrow_mut(&mut alliance.role_bits, subject);
            *current_ref = next;
        };
    };

    event::emit(RoleRevoked {
        alliance_id: alliance.alliance_id,
        subject,
        role_bits: roles,
    });
}

public fun register_node(
    alliance: &mut AllianceRegistry,
    node_id: ID,
    assembly_id: ID,
    node_kind: u8,
    label: String,
    position_hash: vector<u8>,
    initial_mode: u8,
    toll_base: u64,
    risk_multiplier_bps: u64,
    civilian_protection: bool,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_operator(alliance, ctx);
    assert_valid_node_kind(node_kind);
    assert_valid_mode(initial_mode);
    assert!(!table::contains(&alliance.nodes, node_id), E_NODE_EXISTS);

    let policy_id = node_id;
    let policy = PolicyProfile {
        mode: initial_mode,
        toll_base,
        risk_multiplier_bps,
        civilian_protection,
        treaty_exemptions: vector[],
        redlist: vector[],
        whitelist: vector[],
    };
    table::add(&mut alliance.policies, policy_id, policy);
    init_policy_history(alliance, policy_id, tx_context::sender(ctx), clock);

    let registration = NodeRegistration {
        assembly_id,
        owner: tx_context::sender(ctx),
        node_kind,
        label,
        position_hash,
        policy_id,
        updated_at_ms: clock.timestamp_ms(),
    };

    table::add(&mut alliance.nodes, node_id, registration);
    event::emit(NodeRegistered {
        alliance_id: alliance.alliance_id,
        node_id,
        node_kind,
    });
}

public fun set_policy(
    alliance: &mut AllianceRegistry,
    node_id: ID,
    mode: u8,
    toll_base: u64,
    risk_multiplier_bps: u64,
    civilian_protection: bool,
    treaty_exemptions: vector<ID>,
    redlist: vector<address>,
    whitelist: vector<address>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_operator(alliance, ctx);
    assert_valid_mode(mode);
    assert!(table::contains(&alliance.nodes, node_id), E_NODE_NOT_FOUND);

    let registration = table::borrow_mut(&mut alliance.nodes, node_id);
    let policy_id = registration.policy_id;
    assert!(table::contains(&alliance.policies, policy_id), E_POLICY_NOT_FOUND);

    let policy = table::borrow_mut(&mut alliance.policies, policy_id);
    policy.mode = mode;
    policy.toll_base = toll_base;
    policy.risk_multiplier_bps = risk_multiplier_bps;
    policy.civilian_protection = civilian_protection;
    policy.treaty_exemptions = treaty_exemptions;
    policy.redlist = redlist;
    policy.whitelist = whitelist;
    registration.updated_at_ms = clock.timestamp_ms();
    append_policy_snapshot(alliance, policy_id, tx_context::sender(ctx), b"set_policy", clock);

    event::emit(PolicyUpdated {
        alliance_id: alliance.alliance_id,
        node_id,
        policy_id,
        mode,
    });
}

public fun issue_route_pass(
    alliance: &mut AllianceRegistry,
    pass_id: ID,
    character_id: ID,
    route_fingerprint: vector<u8>,
    source_snapshot_id: vector<u8>,
    quoted_risk: u64,
    quoted_cost: u64,
    sponsor_scope: u8,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_operator(alliance, ctx);
    assert!(!table::contains(&alliance.route_passes, pass_id), E_ROUTE_ALREADY_EXISTS);

    let route_pass = RoutePass {
        character_id,
        route_fingerprint,
        source_snapshot_id,
        quoted_risk,
        quoted_cost,
        sponsor_scope,
        sponsor: tx_context::sender(ctx),
        issued_at_ms: clock.timestamp_ms(),
        expires_at_ms,
        consumed: false,
        linked_permit_digest: option::none(),
    };
    table::add(&mut alliance.route_passes, pass_id, route_pass);

    event::emit(RoutePassIssued {
        alliance_id: alliance.alliance_id,
        pass_id,
        character_id,
        quoted_risk,
        quoted_cost,
    });
}

public fun mark_route_pass_consumed(
    alliance: &mut AllianceRegistry,
    pass_id: ID,
    linked_permit_digest: vector<u8>,
    ctx: &TxContext,
) {
    assert_operator(alliance, ctx);
    assert!(table::contains(&alliance.route_passes, pass_id), E_ROUTE_NOT_FOUND);

    let pass = table::borrow_mut(&mut alliance.route_passes, pass_id);
    pass.consumed = true;
    pass.linked_permit_digest = option::some(linked_permit_digest);
}

public fun raise_distress(
    alliance: &mut AllianceRegistry,
    beacon_id: ID,
    character_id: ID,
    location_proof_hash: vector<u8>,
    bond: Coin<SUI>,
    clock: &Clock,
) {
    assert!(!table::contains(&alliance.distress_beacons, beacon_id), E_BEACON_EXISTS);

    let bond_value = coin::value(&bond);
    let responders = vec_map::empty<address, ResponderBond>();
    let beacon = DistressBeacon {
        character_id,
        location_proof_hash,
        status: BEACON_OPEN,
        bond_value,
        bond_pool: coin::into_balance(bond),
        responders,
        opened_at_ms: clock.timestamp_ms(),
    };
    table::add(&mut alliance.distress_beacons, beacon_id, beacon);

    event::emit(DistressRaised {
        alliance_id: alliance.alliance_id,
        beacon_id,
        character_id,
        bond_value,
    });
}

public fun accept_response(
    alliance: &mut AllianceRegistry,
    beacon_id: ID,
    responder_bond: Coin<SUI>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(table::contains(&alliance.distress_beacons, beacon_id), E_BEACON_NOT_FOUND);

    let beacon = table::borrow_mut(&mut alliance.distress_beacons, beacon_id);
    assert!(beacon.status == BEACON_OPEN || beacon.status == BEACON_CLAIMED, E_BEACON_NOT_OPEN);

    let responder = tx_context::sender(ctx);
    assert!(!vec_map::contains(&beacon.responders, &responder), E_RESPONDER_EXISTS);

    let bond_value = coin::value(&responder_bond);
    let responder_record = ResponderBond {
        responder,
        bond_value,
        accepted_at_ms: clock.timestamp_ms(),
    };

    balance::join(&mut beacon.bond_pool, coin::into_balance(responder_bond));
    vec_map::insert(&mut beacon.responders, responder, responder_record);
    beacon.status = BEACON_CLAIMED;

    event::emit(ResponderAccepted {
        alliance_id: alliance.alliance_id,
        beacon_id,
        responder,
        bond_value,
    });
}

public fun resolve_incident(
    alliance: &mut AllianceRegistry,
    incident_id: ID,
    beacon_id: option::Option<ID>,
    killmail_ref: option::Option<ID>,
    summary: String,
    evidence_hashes: vector<vector<u8>>,
    verdict: u8,
    payouts: vector<address>,
    payout_amounts: vector<u64>,
    reward_pool: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_auditor(alliance, ctx);
    assert!(!table::contains(&alliance.incidents, incident_id), E_INCIDENT_EXISTS);
    assert_valid_incident_verdict(verdict);
    assert!(vector::length(&payouts) == vector::length(&payout_amounts), E_PAYOUT_MISMATCH);

    let mut pool = coin::into_balance(reward_pool);
    let mut payout_total = 0;
    let payout_len = vector::length(&payouts);
    let mut i = 0;
    while (i < payout_len) {
        let recipient = *vector::borrow(&payouts, i);
        let amount = *vector::borrow(&payout_amounts, i);
        let payout_coin = coin::from_balance(balance::split(&mut pool, amount), ctx);
        payout_total = payout_total + amount;
        transfer::public_transfer(payout_coin, recipient);

        event::emit(RewardPaid {
            alliance_id: alliance.alliance_id,
            incident_id,
            recipient,
            amount,
        });

        i = i + 1;
    };

    balance::destroy_zero(pool);

    if (option::is_some(&killmail_ref)) {
        event::emit(KillmailLinked {
            alliance_id: alliance.alliance_id,
            incident_id,
            killmail_ref: *option::borrow(&killmail_ref),
        });
    };

    let case = IncidentCase {
        beacon_id,
        killmail_ref,
        evidence_hashes,
        verdict,
        summary,
        payout_total,
        resolved_at_ms: option::some(clock.timestamp_ms()),
    };

    table::add(&mut alliance.incidents, incident_id, case);
    event::emit(IncidentResolved {
        alliance_id: alliance.alliance_id,
        incident_id,
        verdict,
        payout_total,
    });
}

public fun get_node_policy(alliance: &AllianceRegistry, node_id: ID): &PolicyProfile {
    assert!(table::contains(&alliance.nodes, node_id), E_NODE_NOT_FOUND);
    let registration = table::borrow(&alliance.nodes, node_id);
    assert!(table::contains(&alliance.policies, registration.policy_id), E_POLICY_NOT_FOUND);
    table::borrow(&alliance.policies, registration.policy_id)
}

public fun get_policy_version(alliance: &AllianceRegistry, policy_id: ID, version: u64): &PolicySnapshot {
    assert!(table::contains(&alliance.policy_histories, policy_id), E_POLICY_NOT_FOUND);
    let history = table::borrow(&alliance.policy_histories, policy_id);
    let mut i = 0;
    let snapshot_len = vector::length(&history.snapshots);
    while (i < snapshot_len) {
        let snapshot = vector::borrow(&history.snapshots, i);
        if (snapshot.version == version) {
            return snapshot
        };
        i = i + 1;
    };
    abort E_POLICY_VERSION_NOT_FOUND
}

fun init_policy_history(alliance: &mut AllianceRegistry, policy_id: ID, actor: address, clock: &Clock) {
    let policy = *table::borrow(&alliance.policies, policy_id);
    let snapshot = PolicySnapshot {
        version: 1,
        profile: policy,
        changed_by: actor,
        changed_at_ms: clock.timestamp_ms(),
        reason: b"initial_policy",
    };
    let history = PolicyHistory {
        current_version: 1,
        snapshots: vector[snapshot],
    };
    table::add(&mut alliance.policy_histories, policy_id, history);
}

fun append_policy_snapshot(
    alliance: &mut AllianceRegistry,
    policy_id: ID,
    actor: address,
    reason: vector<u8>,
    clock: &Clock,
) {
    assert!(table::contains(&alliance.policy_histories, policy_id), E_POLICY_NOT_FOUND);
    let profile = *table::borrow(&alliance.policies, policy_id);
    let history = table::borrow_mut(&mut alliance.policy_histories, policy_id);
    history.current_version = history.current_version + 1;
    let snapshot = PolicySnapshot {
        version: history.current_version,
        profile,
        changed_by: actor,
        changed_at_ms: clock.timestamp_ms(),
        reason,
    };
    vector::push_back(&mut history.snapshots, snapshot);

    if (vector::length(&history.snapshots) > POLICY_HISTORY_LIMIT) {
        let _oldest = vector::remove(&mut history.snapshots, 0);
    };
}

fun actor_has_role(alliance: &AllianceRegistry, actor: address, role: u64): bool {
    if (actor == alliance.owner) {
        true
    } else if (table::contains(&alliance.role_bits, actor)) {
        let bits = *table::borrow(&alliance.role_bits, actor);
        (bits & role) == role
    } else {
        false
    }
}

fun assert_role_admin(alliance: &AllianceRegistry, ctx: &TxContext) {
    let sender = tx_context::sender(ctx);
    assert!(actor_has_role(alliance, sender, ROLE_TREATY_ADMIN), E_NOT_AUTHORIZED);
}

fun assert_operator(alliance: &AllianceRegistry, ctx: &TxContext) {
    let sender = tx_context::sender(ctx);
    assert!(actor_has_role(alliance, sender, ROLE_OPERATOR), E_NOT_AUTHORIZED);
}

fun assert_auditor(alliance: &AllianceRegistry, ctx: &TxContext) {
    let sender = tx_context::sender(ctx);
    assert!(actor_has_role(alliance, sender, ROLE_AUDITOR), E_NOT_AUTHORIZED);
}

fun assert_valid_node_kind(kind: u8) {
    assert!(kind == NODE_GATE || kind == NODE_TURRET || kind == NODE_STORAGE, E_INVALID_NODE_KIND);
}

fun assert_valid_mode(mode: u8) {
    assert!(mode == MODE_CEASEFIRE || mode == MODE_BLOCKADE || mode == MODE_WARTIME, E_INVALID_MODE);
}

fun assert_valid_incident_verdict(verdict: u8) {
    assert!(verdict == INCIDENT_PENDING || verdict == INCIDENT_CONFIRMED || verdict == INCIDENT_REJECTED, E_INVALID_VERDICT);
}

#[test_only]
public fun node_gate_kind(): u8 { NODE_GATE }

#[test_only]
public fun mode_blockade(): u8 { MODE_BLOCKADE }

#[test_only]
public fun verdict_confirmed(): u8 { INCIDENT_CONFIRMED }

#[test_only]
public fun role_operator(): u64 { ROLE_OPERATOR }

#[test_only]
public fun role_auditor(): u64 { ROLE_AUDITOR }

#[test_only]
public fun mint_admin_for_testing(ctx: &mut TxContext): MeshAdminCap {
    MeshAdminCap { id: object::new(ctx) }
}

#[test_only]
public fun destroy_admin_for_testing(cap: MeshAdminCap) {
    let MeshAdminCap { id } = cap;
    object::delete(id);
}

