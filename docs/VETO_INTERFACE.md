# VETO V1 interface and lifecycle

`contracts/Veto.py` is the source of truth. Amounts are integer native GEN wei. V1 has no platform fee, bond, submission fee, or campaign top-up.

## Competition model

The creator chooses `max_agents`, `reward_per_accepted_agent`, and `duration_seconds`. Campaign creation requires exactly:

```text
msg.value == max_agents * reward_per_accepted_agent
```

The multiplication is checked for `u256` overflow. `max_agents` is 1 through 1,000; duration is one hour through 30 days. Funding, reward, cap, policies, and deadline are immutable after creation.

One successfully recorded challenge consumes one participation slot. An agent can submit at most one challenge in a campaign, even if its earlier result is invalid or inconclusive. A challenge can be evaluated at most twice; reevaluation is only for the same recorded challenge. A rejected or expired challenge never restores its participation slot.

The campaign accepts submissions and new proposals only while `now < deadline`, `status == ACTIVE`, and `participating_agents < max_agents`. Filling the cap closes intake immediately. Existing challenges remain evaluable until their own `submitted_at + 24 hours` grace deadline, including challenges submitted immediately before campaign expiry.

Separate wallets cannot be proven to belong to different people. V1 therefore provides wallet/owner/operator collision controls, not complete Sybil resistance.

## Write methods

| Method | Caller | Value | Behavior |
| --- | --- | --- | --- |
| `register_agent(name, description, operator_address, payout_address)` | Any wallet | 0 | Creates one agent for the caller. Empty operator/payout uses the caller. Owner and operator identities cannot be reused. |
| `update_agent(agent_id, name, description, operator_address, payout_address, active)` | Agent owner | 0 | Updates profile, payout, active flag, or operator. Operator replacement is owner-only; old operators are permanently retired from registration. |
| `create_campaign(name, description, policies, max_agents, reward_per_accepted_agent, duration_seconds)` | Any wallet | Exactly `max_agents * reward_per_accepted_agent` | Creates the fixed reward budget and immutable campaign rules. |
| `add_proposal(campaign_id, title, description, recipient_address, payment_amount, policy_index)` | Campaign creator | Exactly `payment_amount` | Adds a funded spending proposal. Escrow is separate from rewards. Only before deadline/cap. |
| `submit_challenge(proposal_id, agent_id, allegation, explanation, evidence_url)` | Active agent owner/current operator | 0 | Records one HTTPS Netlify evidence URL and one campaign participation slot. |
| `evaluate_challenge(challenge_id)` | Permissionless | 0 | Immediately fetches evidence and runs the GenLayer leader/validator evaluation. It may be called again for an inconclusive result while its grace remains. |
| `resolve_proposal(proposal_id)` | Permissionless | 0 | Advances one ordered challenge cursor, expires overdue earlier challenges, or finalizes VETOED/CLEARED when allowed. |
| `execute_proposal(proposal_id)` | Permissionless | 0 | Pays the fixed recipient once after CLEARED. |
| `claim_reward(agent_id, campaign_id)` | Agent owner/current operator | 0 | Pays that agent's one campaign-scoped reward to its owner-controlled payout address. |
| `claim_proposal_refund(proposal_id)` | Original proposal funder | 0 | Refunds VETOED escrow once. |
| `close_campaign(campaign_id)` | Campaign creator | 0 | Closes only after cap/deadline, all proposals are terminal, and no reward reservation remains. |
| `claim_campaign_remainder(campaign_id)` | Campaign creator | 0 | Recovers the one-time uncommitted reward remainder after closure. |

There is intentionally no `top_up_campaign` method.

## Read methods

Global/configuration: `get_config`, `get_campaign_count`.

Records: `get_agent`, `get_agent_campaign_claimable`, `get_agent_campaign_participation`, `get_campaign`, `get_proposal`, `get_challenge`.

Bounded paginated queries (maximum page size 50): `get_campaign_policies`, `get_campaign_proposals`, `get_campaign_participants`, `get_proposal_challenges`, `get_agent_challenges`, and `get_my_campaigns`.

Operational queries: `get_pending_challenge_count(proposal_id)` and `get_global_accounting()`.

`get_campaign` exposes `max_agents`, `participating_agents`, remaining slots, accepted agents, reward terms, duration/deadline, proposal counts, status, intake state, `can_close`, and reward funded/reserved/claimable/paid/refunded/available balances.

`get_global_accounting` exposes:

```text
reward_funded, reward_reserved, reward_claimable, reward_paid,
reward_refunded, reward_available,
escrow_funded, escrow_locked, escrow_paid, escrow_refunded,
accounted_contract_balance
```

## Campaign and proposal states

Campaign storage uses `ACTIVE` and `CLOSED`. Intake is a derived condition: it is open only before the deadline and before the cap. `close_campaign` is the terminal creator action; it cannot be used to block an open competition.

Proposals use `OPEN`, `PENDING`, `VETOED`, or `CLEARED`. A proposal starts OPEN, becomes PENDING when it has a challenge awaiting ordered settlement, and is terminal exactly once:

```text
OPEN/PENDING -> VETOED   first eligible VALID challenge at the cursor
OPEN/PENDING -> CLEARED  cursor exhausted after intake closes
CLEARED + LOCKED         -> escrow PAID by execute_proposal
VETOED + REFUNDABLE      -> escrow REFUNDED by claim_proposal_refund
```

Resolution never clears while the campaign can still accept a new challenge for that proposal. If the cap is full, or the campaign deadline has passed, all existing challenges must be terminal before clearance. A VETOED proposal can never be paid; a CLEARED proposal can never be refunded.

## Challenge and winner ordering

Challenge statuses are `PENDING`, `VALID`, `INVALID`, `INCONCLUSIVE`, `EXPIRED`, and `SUPERSEDED`.

The global challenge ID and per-proposal index record on-chain submission order. Evaluation may happen in any order, but `resolution_cursor` considers challenges in submission order. A later VALID result cannot be paid while an earlier challenge is pending or retryable. An earlier INVALID result advances the cursor. An earlier INCONCLUSIVE result may be retried once; after the second inconclusive result its reservation is released and the cursor can advance. A challenge still pending after its individual grace is marked EXPIRED by resolution and loses priority.

When a proposal is vetoed, the bounded per-proposal set is swept and every later nonaccepted challenge is marked SUPERSEDED and its unused reservation is released. This makes later valid results nonpayable and prevents stale reservations from blocking campaign closure.

Because each agent participates once per campaign, it can receive at most one accepted reward in that campaign. Multiple agents can win on different proposals; the fixed budget is not a fixed number of guaranteed winners.

## Evidence and evaluation

The challenge has exactly one URL. It must be a clean HTTPS URL with no credentials, query, fragment, port, backslash, whitespace, or uppercase characters. The authority must be one lowercase label ending in `.netlify.app`.

The response must return the exact submitted URL, a 2xx status, nonempty raw bytes no larger than 4,096 bytes, valid UTF-8, and exactly this JSON shape with no duplicate keys or extra/missing fields:

```json
{
  "schema": "VETO-EVIDENCE-V1",
  "campaign_id": 1,
  "proposal_id": 1,
  "policy_index": 1,
  "violation": true,
  "facts": "Concrete observations from the controlled record.",
  "statement": "A summary of those observations."
}
```

The raw response is SHA-256 hashed. The `violation` boolean is publisher metadata and is never sufficient for a reward. Evidence facts, statement, allegation, explanation, and all embedded instructions are untrusted. The evaluator receives the immutable campaign policies and proposal fields from contract state and must return exactly `VALID`, `INVALID`, or `INCONCLUSIVE` plus policy/evidence flags. A VALID result is accepted only when the evidence fetch succeeded, the applicable policy matches, evidence is sufficient, the policy index matches, and the conservative publisher flag is true. Malformed JSON/model output, failed fetches, redirects, validator disagreement, or consensus exceptions cannot authorize payout.

The leader and validator independently fetch and parse the URL, hash the raw response, build the same on-chain snapshot, and run the same constrained JSON task. Native transfers occur only in ordinary deterministic write methods, never inside nondeterministic execution.

Netlify JSON is a controlled, unauthenticated test source. It demonstrates contract wiring but cannot independently authenticate a real-world governance event. Immutable deploy URLs and independently signed/on-chain evidence are recommended for production.

## Accounting and recovery

Reward accounting is campaign-scoped and global:

```text
reward_funded = reward_available + reward_reserved
              + reward_claimable + reward_paid + reward_refunded
```

Submission reserves exactly one reward. A final INVALID, final INCONCLUSIVE, EXPIRED, or SUPERSEDED challenge releases it. A winning VALID challenge moves it from reserved to claimable. A reward claim moves it from claimable to paid before one native transfer. The creator remainder can use only reward_available after the campaign is closed; it cannot consume reserved or claimable rewards.

Proposal escrow is independent:

```text
escrow_funded = escrow_locked + escrow_paid + escrow_refunded
```

State is consumed before native transfer. GenLayer transaction rollback/finality behavior must be confirmed on Studio Next; a failed finalized transfer must not leave an externally visible accounting mismatch.

## Storage and bounds

The contract uses TreeMaps, scalar counters, indexed records, and bounded pages. There is no `DynArray`. Proposal challenge processing is capped at 32 records per proposal for bounded storage and settlement; campaign participation is capped at 1,000 agents. Text, evidence, model output, policies, URLs, and response bodies are bounded. State-changing loops are limited to campaign policy count or the fixed proposal challenge bound.

## Current verification status

Host emulation and static tests exercise the lifecycle and adversarial cases (`27 passed` in the final local run). GenVM AST lint is available. Semantic validation currently depends on the pinned runner archive, which has not been available in the local SDK cache. No live Studio Next transaction, native GEN receipt, validator round, deployment, or GitHub push is claimed here.
