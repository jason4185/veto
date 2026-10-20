import ast
import hashlib
from pathlib import Path


CONTRACT = Path(__file__).parents[1] / "contracts" / "Veto.py"
SOURCE = CONTRACT.read_text(encoding="utf-8")
TREE = ast.parse(SOURCE, filename=str(CONTRACT))


def veto_class():
    return next(node for node in TREE.body if isinstance(node, ast.ClassDef) and node.name == "Veto")


def public_methods():
    result = {}
    for node in veto_class().body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorators = {ast.unparse(item) for item in node.decorator_list}
        if any(item.startswith("gl.public.") for item in decorators):
            result[node.name] = decorators
    return result


def test_contract_header_size_hash_and_no_dynamic_array():
    assert SOURCE.splitlines()[0] == '# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }'
    assert "py-genlayer:test" not in SOURCE
    assert "py-genlayer:latest" not in SOURCE
    assert "DynArray" not in SOURCE
    assert len(SOURCE.encode("utf-8")) < 52000
    assert len(hashlib.sha256(SOURCE.encode("utf-8")).hexdigest()) == 64


def test_storage_is_treemap_only_for_collections():
    annotations = [node for node in veto_class().body if isinstance(node, ast.AnnAssign)]
    assert annotations
    for node in annotations:
        annotation = ast.unparse(node.annotation)
        assert annotation in ("Address",) or annotation.startswith("u256") or annotation.startswith("TreeMap[")
        assert "list" not in annotation.lower()
        assert "dict" not in annotation.lower()


def test_public_interface_contains_lifecycle_and_reads():
    methods = public_methods()
    expected_writes = {
        "register_agent", "update_agent", "create_campaign", "add_proposal",
        "publish_attestation",
        "submit_challenge", "evaluate_challenge", "resolve_proposal", "execute_proposal",
        "claim_reward", "claim_proposal_refund", "close_campaign", "claim_campaign_remainder",
    }
    expected_reads = {
        "get_config", "get_campaign_count",
        "get_agent", "get_agent_by_wallet", "get_agent_campaign_claimable", "get_campaign", "get_campaign_policies",
        "get_campaign_proposals", "get_campaign_participants", "get_agent_campaign_participation",
        "get_proposal", "get_proposal_challenges", "get_challenge",
        "get_agent_challenges", "get_my_campaigns", "get_pending_challenge_count",
        "get_global_accounting",
    }
    assert expected_writes | expected_reads <= set(methods)
    assert all(any(item.startswith("gl.public.write") for item in methods[name]) for name in expected_writes)
    assert all("gl.public.view" in methods[name] for name in expected_reads)
    assert "gl.public.write.payable" in methods["create_campaign"]
    assert "gl.public.write.payable" in methods["add_proposal"]


def test_challenge_is_one_url_and_rewards_are_campaign_scoped():
    submit = next(node for node in veto_class().body if isinstance(node, ast.FunctionDef) and node.name == "submit_challenge")
    names = [arg.arg for arg in submit.args.args]
    assert names[-1] == "evidence_url"
    assert "evidence_urls" not in names
    assert "agent_campaign_claimable" in SOURCE
    assert "campaign.reward_paid" in SOURCE
    assert "campaign.deadline" in SOURCE
    assert "campaign.max_agents" in SOURCE
    assert "campaign.participating_agents" in SOURCE
    assert "campaign_agent_challenge" in SOURCE
    assert "reward_per_accepted_agent" in SOURCE
    assert "identity_agent_id" in SOURCE
    assert "policy_limits" in SOURCE
    assert "attestations" in SOURCE
    assert '"facts"' in SOURCE
    assert "object_pairs_hook" in SOURCE


def test_typed_policy_storage_and_objective_verification_are_explicit():
    campaign = next(node for node in TREE.body if isinstance(node, ast.ClassDef) and node.name == "CampaignState")
    fields = {node.target.id: ast.unparse(node.annotation) for node in campaign.body if isinstance(node, ast.AnnAssign)}
    veto = veto_class()
    storage = {node.target.id: ast.unparse(node.annotation) for node in veto.body if isinstance(node, ast.AnnAssign)}
    assert storage["campaign_policies"] == "TreeMap[str, str]"
    assert "max_payment" not in fields
    assert "payment_limit" not in fields
    assert "MAX_PAY_PREFIX" in SOURCE
    assert "DETERMINISTIC" in SOURCE


def test_nondeterminism_and_native_transfer_are_isolated():
    nondet_functions = []
    transfer_functions = []
    for node in ast.walk(TREE):
        if not isinstance(node, ast.FunctionDef):
            continue
        calls = [ast.unparse(child) for child in ast.walk(node) if isinstance(child, ast.Call)]
        if any("gl.vm.run_nondet" in call for call in calls):
            nondet_functions.append(node.name)
        if any("emit_transfer" in call for call in calls):
            transfer_functions.append(node.name)
    assert nondet_functions == ["_semantic_consensus"]
    assert transfer_functions == ["_transfer"]


def test_state_changing_loops_are_bounded_by_technical_limits():
    write_nodes = []
    for node in veto_class().body:
        if not isinstance(node, ast.FunctionDef):
            continue
        decorators = {ast.unparse(item) for item in node.decorator_list}
        if "gl.public.write" in decorators or "gl.public.write.payable" in decorators:
            write_nodes.append(node)
    for node in write_nodes:
        if node.name in ("create_campaign", "_finish_vetoed"):
            continue
        for loop in ast.walk(node):
            if not isinstance(loop, (ast.For, ast.While)):
                continue
            raise AssertionError((node.name, ast.unparse(loop)))


def test_financial_invariant_fields_and_order_cursor_exist():
    for field in (
        "total_reward_funded", "total_reward_reserved", "total_reward_claimable", "total_reward_paid",
        "total_reward_refunded", "total_escrow_funded", "total_escrow_locked", "total_escrow_paid",
        "total_escrow_refunded", "resolution_cursor", "winner_challenge_id", "remainder_claimed",
    ):
        assert field in SOURCE
    assert "resolution_cursor" in SOURCE
    assert "MAX_ATTEMPTS" in SOURCE
