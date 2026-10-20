# VETO contract interface and security boundary

`contracts/Veto.py` is the authoritative local interface. The current deployment is `0x302798B9e6C5603527E67A55fBdA47Ddea97E6F4`, but it predates the local `get_agent_by_wallet` revision; the historical deployment `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8` is unchanged and uses separate state.

Local artifact: 51,986 UTF-8 bytes, SHA-256 `6041e7b033e9ab619e784412fce3becc9ce1214e850d09375ee3aca784b3016d`.

## Public writes

```text
register_agent(name, description, operator_address, payout_address)
update_agent(agent_id, name, description, operator_address, payout_address, active)
create_campaign(name, description, policies, max_agents, reward_per_accepted_agent, duration_seconds) payable
add_proposal(campaign_id, title, description, recipient_address, payment_amount, policy_index) payable
publish_attestation(campaign_id, proposal_id, policy_index, evidence_sha256, expires_at)
submit_challenge(proposal_id, agent_id, allegation, explanation, evidence_url)
evaluate_challenge(challenge_id)
resolve_proposal(proposal_id)
execute_proposal(proposal_id)
claim_reward(agent_id, campaign_id)
claim_proposal_refund(proposal_id)
close_campaign(campaign_id)
claim_campaign_remainder(campaign_id)
```

`publish_attestation` is callable only by the deployment `evidence_authority`, initialized to the deployer, with no rotation method. It rejects authority self-attestation of a campaign, expired records, malformed hashes, and duplicate exact keys. The key binds chain/address/campaign/proposal/policy snapshot and evidence hash; the expiry is stored on-chain. This is an explicit trust root: it authenticates an authority decision, not the external world. The current frontend exposes an adapter for this privileged write but intentionally has no public self-service attestation screen; semantic evidence requires an independently operated authority workflow.

## Policy encoding

Each non-empty line in `policies` is immutable. A line beginning exactly with:

```text
MAX_PAYMENT_WEI:<positive decimal wei>
```

is a deterministic payment constraint. Its parsed `u256` value is returned by `get_campaign_policies` as `limit_wei` and by proposal views as `policy_limit_wei`. The contract compares this value with the actual proposal `payment_amount`.

Any other policy is semantic. Its evidence URL must still be a single HTTPS `*.netlify.app` URL with no credentials, query, fragment, port, redirect, unsafe host label, or whitespace. The response must be bounded JSON with exact schema and matching IDs. These checks establish retrieval and context, not real-world authenticity. A semantic `VALID` must also match an unexpired authority attestation or it becomes `INVALID` with `evidence_status=AUTH_REQUIRED`. Validators independently rerun the web/LLM task, but validator agreement cannot replace this authority gate.

## Public views

The existing lifecycle reads remain available: configuration, campaign/agent/proposal/challenge records, paginated policies/proposals/participants/history, participation and claimable reward lookups, pending challenge count, and global accounting.

`get_agent_by_wallet(wallet_address)` is the new direct lookup. It validates the supplied address, reads the shared `identity_agent_id` reservation, rejects zero/retired/sentinel/missing records, and verifies that the live agent owner or current operator still matches. It returns the agent ID as `u256`; `0` means no current agent. Payout addresses are never included in this lookup. Inactive agents remain identifiable but cannot submit challenges.

`get_config()` now additionally returns:

```json
{
  "evidence_authority": "0x...",
  "typed_policy_prefix": "MAX_PAYMENT_WEI:"
}
```

Frontend adapters must require these fields before treating a deployment as the corrected interface. The old deployment should not be silently presented as security-remediated. Settlement UI proves only the parent GenLayer transaction; the current contract has no contract-level receipt for external ghost delivery.

## Lifecycle guarantees

- Campaign funding is fixed at `max_agents * reward_per_accepted_agent`; no top-up exists.
- Proposal escrow is separately funded and settled only once.
- An agent can submit once per campaign; owner and operator roles share one identity reservation.
- Challenges are evaluated immediately when submitted, with bounded retries and ordered resolution.
- The earliest eligible valid challenge wins its proposal; later challenges cannot overtake it.
- Rewards are campaign-scoped; claims, refunds, payments and remainder withdrawal are one-way after successful transfer.
- `_transfer` is called before those one-way commits. This proves synchronous exception safety in host emulation, not asynchronous child-message recovery.

## Migration

Changing the local source does not change either deployed address. A future deployment of this 30-method interface has fresh storage. Existing campaigns, registered agents, claimable rewards, proposal escrows, and pending transactions remain associated with their original address and cannot be mixed with new-contract reads. A migration requires an explicit, separately audited mechanism and user approval.

## Validation status

Local host/static suite: **39 passed**. Python 3.12 compilation and GenVM AST lint pass. The exact v0.6.0-rc6 manager/executor bundle was hash-checked, its runners passed `genvm check` and manager `check-install`, and it executed the previously recorded deterministic cases locally. The contract now reflects 30 public methods (17 views and 13 writes) by AST; stock exact-runner schema/semantic validation remains blocked by `E101` because the installed linter expects an exact-runner `.tar` member while the official bundle provides `.zip`. No other runner was substituted and no full nondeterministic validator execution is claimed. The existing replacement address has not been redeployed or modified; no funded transaction or GEN transfer was performed in this work.
