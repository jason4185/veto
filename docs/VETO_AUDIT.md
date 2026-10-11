# VETO V1 security audit and final refactor review

## Scope and verdict

- Contract: `contracts/Veto.py`
- Model: fixed-budget GEN governance competition with creator-selected participation cap, reward, and campaign deadline.
- Reference: `/Users/jxson/Desktop/PITCH` was read-only and was not modified.
- Runner: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`
- Final UTF-8 source size: **51,465 bytes**; hard-limit headroom: **535 bytes**.
- Final SHA-256: `82d7559f8932bbd01f137804e78692bba4fac5956e08cf26ad7412bb542ba044`.
- `DynArray` verification: absent from the contract source; all persistent collections are TreeMaps.
- Refactor baseline: 50,991 bytes, SHA-256 `6bd18e488470613b5498dfe9dd4e116a57004ba8d6995fd90a5523b53c1aa908`; the final source is 474 bytes larger because the fixed-budget/cap/deadline/participation lifecycle adds required state and reads while remaining below the strict ceiling.
- Assessment: no known critical or high-severity source-level defect remains in the locally testable implementation. It is ready for Studio Next testing, not deployment approval.

This is a source, static-lint, AST, and host-emulation audit. It does not replace live multi-validator execution, finality testing, or independent evidence authentication.

## Refactor summary

The old open-ended pool, `top_up_campaign`, per-proposal challenge windows, and after-window-only evaluation were removed. Campaign creation now requires exact fixed funding:

```text
required_funding = max_agents * reward_per_accepted_agent
```

The cap is a participation cap, not a winner guarantee. One accepted submission consumes one campaign slot; a final invalid, inconclusive, expired, or superseded result releases its reward reservation but never restores the slot. Each agent can submit once and therefore earn at most one reward per campaign. Different agents can win on different proposals.

## GenLayer compatibility review

The installed `genlayer-dev` skill was read, including write-contract, direct-tests, integration-tests, and GenVM-lint instructions. PITCH confirmed the following patterns:

- pinned `py-genlayer` dependency;
- `TreeMap` plus `@allow` dataclasses;
- `gl.vm.run_nondet` with a substantive independent validator rerun;
- `gl.nondet.web.get` for raw external responses;
- `gl.nondet.exec_prompt(..., response_format="json")`;
- `_Recipient(address).emit_transfer(value=amount)` for native GEN.

The contract uses no local-only runner alias, no `DynArray`, no native transfer inside nondeterministic code, and no state-changing unbounded collection scan. The semantic linter's AST phase passes. Semantic validation is blocked locally because the pinned runner archive is missing from the SDK cache:

```text
filename 'runners/py-genlayer/5j/ycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng.tar' not found
```

## Storage review

Storage is scalar-counter plus TreeMap only:

- agents, owner and operator identity indexes;
- campaigns, creator campaign indexes, and immutable policy text;
- proposals and campaign proposal indexes;
- proposal challenge indexes;
- campaign-agent participation and participant indexes;
- challenges, agent challenge history, and campaign-scoped claimable balances;
- global reward and proposal-escrow accounting counters.

Records are bounded by validation limits. Reads use offset/limit pages with a maximum of 50. Proposal resolution and terminal supersession use the fixed 32-challenge technical cap. There is no loop over all campaigns, all agents, or all global challenges.

## Lifecycle audit

### Campaign

`ACTIVE` accepts proposals and challenges only when `now < deadline` and `participating_agents < max_agents`. The cap or deadline closes intake without blocking previously submitted challenges. The creator cannot close while intake is open, a proposal is nonterminal, or a reward reservation remains. After all obligations settle, `close_campaign` changes the state to `CLOSED`. Claimable agent rewards remain available after closure. The creator can claim only the remaining uncommitted reward balance.

### Proposal

Creation requires creator authorization, active intake, a nonzero recipient, a nonzero payment, and exact payable escrow. The escrow is never deducted from or used as the reward pool.

| Current | Event | Next |
| --- | --- | --- |
| OPEN/PENDING | ordered cursor reaches VALID | VETOED |
| OPEN/PENDING | intake closed and cursor exhausts terminal nonvalid challenges | CLEARED |
| CLEARED + LOCKED | `execute_proposal` | escrow PAID |
| VETOED + REFUNDABLE | `claim_proposal_refund` | escrow REFUNDED |
| terminal | repeated resolve/execute/refund | rejected |

No path permits both payment and refund. No path permits both CLEARED and VETOED.

### Challenge and evaluation

Submission is immediate and permissionless within active-agent authorization. It stores one URL, allegation, explanation, timestamp, ordered index, and one reward reservation. It atomically consumes a campaign participation slot and writes the campaign-agent uniqueness key.

Evaluation is eligible immediately and may happen before or after campaign expiry. The grace deadline is `submitted_at + 24 hours`, not campaign deadline plus an old proposal window. At most two attempts are allowed. A failed fetch, malformed evidence, malformed model result, validator disagreement, or consensus exception is INCONCLUSIVE. The first terminal invalid/final inconclusive/expired/superseded outcome releases the reserved reward.

Resolution uses `resolution_cursor`, independent of evaluation order:

1. A later VALID result cannot win while an earlier record is unresolved.
2. An earlier INVALID result advances the cursor.
3. An earlier retryable INCONCLUSIVE blocks until retry or grace expiry.
4. A pending challenge past its individual grace becomes EXPIRED during resolution.
5. The first VALID record at the cursor receives the one proposal reward.
6. A veto sweeps the bounded later set into SUPERSEDED and releases unused reservations.

This preserves earliest eventual-valid submission priority while permitting liveness after bounded failures.

## Agent identity and anti-spam audit

Registration stores one owner-to-agent mapping. An operator can control only one identity. Operator replacement is owner-only, the replacement must be unused, and the prior operator is permanently retired from new registration. Deactivation does not clear owner/operator maps or campaign participation. Submission and claims check the owner or current operator; only active agents can submit. A campaign-agent TreeMap prevents a second agent ID from participating again through the same registered owner/operator identity.

This is not complete Sybil resistance. Separate wallets cannot reliably be linked to one person without an identity oracle, bond, or fee; V1 deliberately has none.

## Evidence and consensus audit

URL validation rejects HTTP, credentials, query, fragment, port, backslash, whitespace, uppercase authorities, non-Netlify hosts, and multi-label subdomains. The fetched final URL must equal the submitted URL, preventing redirects to unauthorized hosts. Status must be 2xx, raw bytes must be nonempty and no larger than 4,096 bytes, UTF-8 must decode, and JSON must have exactly the expected keys with duplicate keys rejected. Campaign, proposal, and policy context must match on-chain values. Raw bytes are SHA-256 hashed.

The `violation` flag is treated as untrusted metadata and cannot independently authorize a reward. The prompt gives the immutable policy/proposal context to GenLayer, distinguishes facts from allegations, rejects unsupported/contradictory/unrelated content, and ignores instructions embedded in data. A VALID result additionally requires matching policy, sufficient evidence, successful fetch, exact policy index, and the conservative true metadata gate.

The validator independently repeats retrieval, parsing, hashing, prompt evaluation, and normalized result comparison. It does not merely check JSON shape or trust leader output. Native transfers are outside all nondeterministic functions. Unexpected consensus output is converted to a safe INCONCLUSIVE attempt.

Trust limitation: Netlify JSON is controlled and unauthenticated. It can demonstrate contract behavior but is not independent proof of a real-world violation. Immutable deploy URLs and cryptographically authenticated/on-chain facts are still required for stronger provenance.

## Financial audit

For every campaign:

```text
reward_funded = reward_available
              + reward_reserved
              + reward_claimable
              + reward_paid
              + reward_refunded
```

Global counters use the same equation. The reservation model guarantees `reward_reserved <= max_agents * reward_per_accepted_agent` because each reservation is tied to one unique participation slot and exact initial funding is required.

For each proposal escrow:

```text
escrow_funded = escrow_locked + escrow_paid + escrow_refunded
```

Reward claims, escrow refunds, proposal execution, and campaign remainder recovery consume one-way state before one nonzero native transfer. Claim keys include campaign ID, preventing cross-campaign balances. The creator cannot withdraw reserved or claimable reward funds. The contract never pays a vetoed recipient and funder refund from the same escrow.

The view `accounted_contract_balance` is:

```text
reward_available + reward_reserved + reward_claimable + escrow_locked
```

Paid/refunded amounts have left the contract and are intentionally excluded.

## Access-control matrix

| Action | Authorization |
| --- | --- |
| Register agent | Caller becomes owner; owner/operator uniqueness enforced |
| Update agent | Agent owner only |
| Create campaign | Permissionless creator assignment; exact payable value |
| Add proposal | Campaign creator; exact proposal escrow; active intake |
| Submit challenge | Active agent owner/current operator; one campaign slot |
| Evaluate/resolve/execute | Permissionless; deterministic state gates |
| Claim reward | Agent owner/current operator for that agent |
| Proposal refund | Original proposal funder |
| Close/remainder | Campaign creator, only after finalization conditions |

## Findings and remediation

### High — fixed: campaign-wide participation bypass

The previous model allowed one wallet to register multiple agent IDs and consume a proposal's challenge slots. The refactor enforces one owner identity, one current operator identity, permanently retires replaced operators, and adds a campaign-agent participation key. A slot is consumed permanently on successful submission.

### High — fixed: old open-ended funding and proposal reservation model

The previous model permitted top-ups and reserved one reward per proposal. V1 now requires exact `max_agents * reward` funding and reserves only when an agent participates. There is no replenishment or reward-term mutation.

### High — fixed: evaluation-order winner race

Evaluation remains immediate, but settlement is ordered by the per-proposal cursor. Later evaluation cannot bypass an earlier pending, retryable, or eventually-valid submission. Bounded expiry and terminal supersession preserve liveness.

### High — fixed: proposal and reward-ledger conflation

Proposal escrow is tracked separately from reward deposits/reservations/claims/paid/refunded values. The tests reconcile both ledgers across campaigns.

### Medium — fixed: evidence self-attestation and redirect risk

The evidence flag is not trusted alone; facts and statement are separately validated, raw bytes are hashed, duplicate keys and mismatched context are rejected, and final redirects are rejected. Controlled Netlify provenance remains a documented limitation.

### Medium — fixed: malformed consensus output

The complete normalized consensus shape is validated. Exceptions and malformed output become INCONCLUSIVE, never VALID or an implicit payout.

### Low — accepted: separate-wallet Sybil identity

V1 remains free to participate and does not claim person-level identity. Separate wallets can still represent one actor.

## Test coverage and status

The local suite includes fixed funding, exact value rejection, invalid bounds, no top-up, multiple proposals, immediate valid/invalid/inconclusive evaluation, individual grace expiry, deadline/cap intake closure, ordered earlier/later outcomes, automatic supersession, one campaign participation, owner/operator/deactivation controls, malformed/duplicate/context-mismatched/redirect/prompt-injection evidence, pagination, unauthorized writes/claims/refunds, replay protection, escrow paths, cross-campaign claims, and accounting reconciliation.

Executed with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` because the installed Python plugin otherwise fails on `collections.abc.Buffer`:

```text
27 passed in 0.31s
```

The suite includes six static checks and 21 host-emulation tests. The reported execution passed after the final source changes.

Not performed: live Studio Next transactions, finalized native GEN receipts, real validator rounds, or deployment. Semantic validation remains blocked by the missing pinned runner archive.

## Deployment readiness

The contract is ready for Studio Next testing after the local checks pass. It is not deployment-ready until the exact pinned runner is available, semantic validation succeeds, leader/validator behavior is exercised, native GEN transfer rollback/finality is verified, and the evidence provenance/trust model is accepted by product owners.
