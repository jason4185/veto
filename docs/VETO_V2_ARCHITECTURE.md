# VETO secure architecture (single-contract remediation)

This document keeps the historical filename used by the repository. The remediation is implemented in the existing `contracts/Veto.py`; it is not a second VETO project or a parallel codebase. The current Studio Next deployment is `0x1F7df5eb0888c8B4628DC11895B8a90C7e3aF6Dd`; older deployments have separate state. Any future replacement deployment, if approved, would also have separate on-chain state because GenLayer deployment does not migrate storage automatically.

## Decision

The smallest defensible boundary is hybrid:

1. Objective payment limits use an immutable, machine-readable campaign policy encoded as `MAX_PAYMENT_WEI:<positive decimal wei>`. Campaign creation stores the exact policy text and its parsed `u256` limit in `policy_limits`. `evaluate_challenge` compares the immutable proposal `payment_amount` with that stored limit. Evidence bytes, `violation`, prompts and validator opinions cannot change this result.
2. Semantic policies still use GenLayer nondeterministic evaluation, but a `VALID` result is not reward-authorizing unless the configured `evidence_authority` has published an on-chain attestation for the exact evidence hash and current proposal/policy snapshot. The authority cannot attest a campaign it created.
3. Missing, expired, replayed, substituted, or context-mismatched attestations are rejected for reward purposes. There is no claim that Netlify, HTTPS, SHA-256, or validator agreement authenticates real-world facts.

The authority record is an authenticated on-chain transaction, not an invented Python signature-recovery API. It is a trust root: the deployment authority must independently review the source artifact and facts. Authority compromise or collusion remains a risk and requires operational controls or a future verifier/oracle.

## Objective policy

For the reviewer example:

```text
campaign policy: MAX_PAYMENT_WEI:5000000000000000000
proposal payment_amount: 8000000000000000000
result: 8 GEN > 5 GEN -> VALID / DETERMINISTIC
```

The proposal amount is escrow supplied by the creator and stored by the contract. The limit is parsed once during campaign creation and cannot be edited. Arbitrary prose is never parsed as a numeric security constraint; it takes the semantic path instead.

## Semantic policy

The authority calls:

```text
publish_attestation(campaign_id, proposal_id, policy_index, evidence_sha256, expires_at)
```

The storage key binds the campaign, proposal, policy, evidence digest, and SHA-256 snapshot of:

```text
chain_id | contract_address | campaign_id | proposal_id | recipient |
payment_amount | policy_index | exact_policy_text | typed_limit
```

The stored value is the expiry. The exact key can be written only once, so a changed proposal/context cannot reuse a record and a duplicate request cannot extend or replace it. `evaluate_challenge` independently fetches and hashes the current response, validates its context, runs the leader/validator semantic task, and accepts a semantic `VALID` only when the digest and snapshot key are currently attested.

This is stronger than the old model but not a claim that the authority itself is a decentralized oracle. A future production trust root should use an audited authority registry or verifier contract. No unsupported GenVM signature primitive is assumed here.

## Validator independence

`_semantic_consensus` still runs leader and validator evaluation. The prompt marks all fetched evidence text as untrusted and requires substantive comparison. Consensus validates agreement over the task result; it does not create provenance. The contract’s separate attestation gate prevents consensus over an attacker-selected document from authorizing a reward.

## Transfer boundary

`_transfer` is the only native GEN emission boundary. The four outgoing methods call it before one-way state/accounting changes. This is fail-safe for a synchronous exception in the host model: state remains owed and a successful later call is guarded as single-use. GenLayer’s external EVM/ghost child-message semantics remain a live-runtime assumption; the contract does not automatically retry an ambiguous emission or claim that child failure is rolled back. See the reviewer evidence report.

## Migration

The historical deployments at `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8` and `0x302798B9e6C5603527E67A55fBdA47Ddea97E6F4` are unchanged. A replacement deployment starts with no campaigns, agents, claimable rewards, or escrow. Existing users and balances cannot be silently moved. Any migration must be separately designed, funded, approved, and tested; legacy semantic findings cannot be retroactively made authenticated by changing this source.

## Acceptance evidence still required

- Full GenVM semantic execution validation with the pinned runner through a manager-compatible toolchain. The exact runner is locally available, but the installed linter cannot consume the current `.zip`/SDK layout; schema reflection alone is insufficient.
- Controlled Studio Next deployment and source/hash verification.
- Live multi-validator objective and attested-semantic evaluations.
- Finalized child-message/recipient tests for all four transfer paths.
- Accounting checks across failed, ambiguous, appealed, retried, and duplicate submissions.
- Frontend tests against the exact replacement address and interface.
