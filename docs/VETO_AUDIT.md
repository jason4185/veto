# VETO security audit and remediation

## Scope

- Authoritative source: `contracts/Veto.py`.
- Runner pin: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`.
- Network target: GenLayer Studio Next, chain `61997`.
- Corrected replacement deployment: `0x302798B9e6C5603527E67A55fBdA47Ddea97E6F4`; live source retrieval matches the local artifact hash and size.
- Existing deployment: `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8`; it was not modified.
- Local source artifact: **51,948 UTF-8 bytes**, SHA-256 **`04b8faac2167ad24185f267509ee27ff5013c2c22c74707dff466a0cb26132aa`**; 52 bytes below the 52,000-byte limit.
- This is a single-contract remediation. The retained `VETO_V2_ARCHITECTURE.md` filename describes the versioned security boundary, not a separate project.

## Findings and status

### High — attacker-controlled evidence (objective path fixed; semantic path not independently closed)

The old path treated a Netlify URL, valid JSON, matching context, SHA-256, and validator agreement as sufficient for a `VALID` finding. The attacker controlled the bytes and could write a convincing false narrative. The hash committed to the narrative, not to independent truth.

The current path has two explicit classes:

- `MAX_PAYMENT_WEI:<decimal wei>` is parsed and stored during `create_campaign`. `evaluate_challenge` compares `ProposalState.payment_amount` to the stored limit. The JSON body and LLM do not participate in that authorization decision.
- All other policies remain semantic and are evaluated through the existing leader/validator task, but a `VALID` result becomes reward-authorizing only if the deployment `authority` has published an on-chain attestation for the current chain/address/campaign/proposal/policy snapshot and exact fetched evidence hash. Missing or invalid authentication is `INVALID`/`AUTH_REQUIRED` and releases the reserved reward.

The contract can verify on-chain and byte-level facts. It cannot prove that a public web artifact is truthful. The authority is therefore an explicit trust root and a remaining operational risk, not hidden behind a claim of HTTPS authenticity. A stronger production model would use an audited authority registry/verifier supported by the target runtime.

### High — owner/operator cross-role identity bypass (fixed locally)

`identity_agent_id` reserves both roles. Registration and operator replacement use the same map; a retired delegated operator is permanently reserved; participation checks the current owner/operator and active flag. A person can still control unrelated wallets; that is a Sybil limitation, not a cross-role registration bypass.

### High operational — asynchronous native GEN delivery (not closed)

The four outgoing methods call `_transfer` before one-way accounting updates. This protects against synchronous exceptions in the host model. `_Recipient` is an EVM interface and the installed SDK lowers `emit_transfer` to `EmitExternalMessage`; these are external ghost messages, not internal IC child calls. GenLayer documentation says they are executed by `handleOp` after finalization, while Studio has no live ghost/EVM layer. The installed client can enumerate internal message child IDs but has no authenticated external-delivery result. The protocol ABI exposes low-level `flushExternalMessages`, `getPendingTransactionValue`, and `executeMessage(...)->bool`, but VETO has no supported callback or recovery mechanism for them. The contract never blindly retries an ambiguous emission. Full safety remains unproven and all four payment paths remain outside a complete fund-safety guarantee until real chain-level delivery and recovery semantics are established.

## Lifecycle and invariants

Campaigns use fixed funding `max_agents * reward_per_accepted_agent`; no top-ups are available. Proposal escrow is separately funded and cannot pay rewards. Each agent has one campaign participation slot, challenges resolve in submission order, and at most one challenge wins a proposal. Rewards are campaign-scoped and claim keys are cleared only after transfer success.

```text
reward_funded = reward_available + reward_reserved + reward_claimable
              + reward_paid + reward_refunded
escrow_funded = escrow_locked + escrow_paid + escrow_refunded
```

The contract uses bounded TreeMaps and pages; no DynArray or unbounded state-changing loop is used. Native transfers are isolated in `_transfer`.

## Source references

Current compact-source function references:

- `_fetch_evidence` line 308; `_semantic_consensus` line 390.
- `_policy_limit` line 268; `_snapshot_hash` line 122.
- `publish_attestation` line 655; `evaluate_challenge` line 716.
- `register_agent` line 562; `update_agent` line 579; `submit_challenge` line 676.
- `_transfer` line 496; payment/reward/refund/remainder methods lines 813, 823, 843, and 866.

## Local proof

`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q`: **38 passed**. This includes fabricated JSON/hash, false and genuine typed limits, context mismatch, mutable evidence, prompt injection, duplicate keys, attestation replay/expiry/context checks, identity attacks, ordered settlement, failed/ambiguous transfers, replay protection, and accounting isolation.

Python compilation and GenVM AST lint (3 checks) pass. The exact pinned runner is available in the official GenVM Manager `v0.6.0-rc6` bundle. The universal bundle SHA-256 is `bd30580f911338d5533460eca8ed714dec371de5803c04e41dbb96430aea7b6e`; its exact runner member is a `.zip` with SHA-256 `2cbcc8389744c4321852d2c0b4bfcef0729bfd22467e2aaf0d4d204cf6f015eb`. The official arm64 macOS execution bundle was independently checked against `SHA256SUMS` (`25995423dedb468d5d70673759e90dfaf33fe1b455982c343c2795952ae5e312`). Its `genvm check` and manager `check-install` both passed. Exact-manager SDK schema reflection passed for 29 methods (16 views, 13 writes, zero constructor parameters), and the exact bundled executor successfully ran initialization, typed-policy setup, 5 GEN/8 GEN and 5 GEN/4 GEN objective evaluations, invalid-constraint rejection, authority/context rejection, cross-role identity rejection, and an outbound `ExternalMessage` emission. The emitted message and post-emission `PAID` state are local executor observations, not proof of live ghost delivery. Stock `genvm-lint check` still fails with `E101` because it looks for `runners/py-genlayer/...<hash>.tar`, while the official bundle provides the exact runner as `.zip`; no replacement runner was used. Full nondeterministic semantic/validator execution and live Studio Next ghost delivery remain unproven. The replacement address has been read-verified; no funded Studio Next transaction, finalized child transfer, Vercel update, GitHub push, or financial transaction was performed in this worktree.

Frontend adapter/tests/build after the remediation pass: TypeScript passed, Vitest passed 84 tests across 11 files, ESLint passed with 0 errors and 15 existing warnings, Prettier passed, and the production build passed with advisory chunk-size/configuration warnings. The adapter was read-verified against the replacement address; no funded transaction was performed.

The frontend adapter references exactly the 29 methods in the exact-runner schema. The contract intentionally exposes `get_agent(agent_id)` but no `get_agent_count()` view; the initial read-only smoke plan must not invent that method or infer a global count from unrelated data.

## Deployment and migration

The old address remains historical and retains its old state/code. The corrected replacement `0x302798B9e6C5603527E67A55fBdA47Ddea97E6F4` starts empty: campaigns, agents, rewards, escrows, and pending claims do not migrate automatically. Its source hash, schema, initial config, and read-only state are verified; live validator rounds, semantic validation through the stock tool, and real chain-level external-delivery tests remain unverified. Any production frontend rollout still requires separate approval and must not mix the two addresses.
