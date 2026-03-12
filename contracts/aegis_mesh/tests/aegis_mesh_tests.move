#[test_only]
module aegis_mesh::aegis_mesh_tests;

use std::string;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario;

use aegis_mesh::aegis_mesh;

const ADMIN: address = @0xA;

public struct Marker has key {
    id: UID,
}

fun new_marker(ctx: &mut sui::tx_context::TxContext): Marker {
    Marker { id: object::new(ctx) }
}

fun marker_id(marker: &Marker): sui::object::ID {
    object::id(marker)
}

fun destroy_marker(marker: Marker) {
    let Marker { id } = marker;
    object::delete(id);
}

fun setup_alliance(scenario: &mut test_scenario::Scenario) {
    test_scenario::next_tx(scenario, ADMIN);
    {
        let ctx = test_scenario::ctx(scenario);
        let admin = aegis_mesh::mint_admin_for_testing(ctx);
        aegis_mesh::create_registry(&admin, ctx);
        aegis_mesh::destroy_admin_for_testing(admin);
    };

    test_scenario::next_tx(scenario, ADMIN);
    let mut registry = test_scenario::take_shared<aegis_mesh::MeshRegistry>(scenario);
    {
        let ctx = test_scenario::ctx(scenario);
        let admin = aegis_mesh::mint_admin_for_testing(ctx);
        let alliance = new_marker(ctx);
        aegis_mesh::create_alliance_registry(
            &admin,
            &mut registry,
            marker_id(&alliance),
            ADMIN,
            ctx,
        );
        destroy_marker(alliance);
        aegis_mesh::destroy_admin_for_testing(admin);
    };
    test_scenario::return_shared(registry);
}

#[test]
fun register_node_and_update_policy() {
    let mut scenario = test_scenario::begin(ADMIN);
    setup_alliance(&mut scenario);

    test_scenario::next_tx(&mut scenario, ADMIN);
    let mut alliance = test_scenario::take_shared<aegis_mesh::AllianceRegistry>(&scenario);
    {
        let ctx = test_scenario::ctx(&mut scenario);
        let clock = clock::create_for_testing(ctx);
        let node = new_marker(ctx);
        let assembly = new_marker(ctx);

        aegis_mesh::register_node(
            &mut alliance,
            marker_id(&node),
            marker_id(&assembly),
            aegis_mesh::node_gate_kind(),
            string::utf8(b"Border Gate"),
            b"hash",
            aegis_mesh::mode_blockade(),
            12,
            1400,
            true,
            &clock,
            ctx,
        );

        aegis_mesh::set_policy(
            &mut alliance,
            marker_id(&node),
            aegis_mesh::mode_blockade(),
            20,
            1700,
            false,
            vector[],
            vector[ADMIN],
            vector[ADMIN],
            &clock,
            ctx,
        );

        destroy_marker(node);
        destroy_marker(assembly);
        clock::destroy_for_testing(clock);
    };
    test_scenario::return_shared(alliance);
    test_scenario::end(scenario);
}

#[test]
fun issue_distress_and_resolve_incident() {
    let mut scenario = test_scenario::begin(ADMIN);
    setup_alliance(&mut scenario);

    test_scenario::next_tx(&mut scenario, ADMIN);
    let mut alliance = test_scenario::take_shared<aegis_mesh::AllianceRegistry>(&scenario);
    {
        let ctx = test_scenario::ctx(&mut scenario);
        let clock = clock::create_for_testing(ctx);
        let beacon = new_marker(ctx);
        let incident = new_marker(ctx);
        let character = new_marker(ctx);
        let killmail = new_marker(ctx);
        let distress_coin = coin::mint_for_testing<SUI>(25, ctx);
        let reward_pool = coin::mint_for_testing<SUI>(50, ctx);

        aegis_mesh::raise_distress(
            &mut alliance,
            marker_id(&beacon),
            marker_id(&character),
            b"proof",
            distress_coin,
            &clock,
        );

        aegis_mesh::accept_response(
            &mut alliance,
            marker_id(&beacon),
            coin::mint_for_testing<SUI>(10, ctx),
            &clock,
            ctx,
        );

        aegis_mesh::resolve_incident(
            &mut alliance,
            marker_id(&incident),
            option::some(marker_id(&beacon)),
            option::some(marker_id(&killmail)),
            string::utf8(b"Resolved border skirmish"),
            vector[b"evidence-1"],
            aegis_mesh::verdict_confirmed(),
            vector[ADMIN],
            vector[50],
            reward_pool,
            &clock,
            ctx,
        );

        destroy_marker(beacon);
        destroy_marker(incident);
        destroy_marker(character);
        destroy_marker(killmail);
        clock::destroy_for_testing(clock);
    };
    test_scenario::return_shared(alliance);
    test_scenario::end(scenario);
}
