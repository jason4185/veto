# VETO security audit and remediation

## Scope

- Authoritative source: `contracts/Veto.py`.
- Runner pin: `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`.
- Network target: GenLayer Studio Next, chain `61997`.
- Current deployed address: `0x1F7df5eb0888c8B4628DC11895B8a90C7e3aF6Dd`; its 30-method interface and fresh zero state were verified read-only on Studio Next.
- Historical deployment: `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8`; it was not modified.
- Local source artifact: **51,986 UTF-8 bytes**, SHA-256 **`6041e7b033e9ab619e784412fce3becc9ce1214e850d09375ee3aca784b3016d`**; 14 bytes below the 52,000-byte limit.
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

`get_agent_by_wallet(wallet_address)` reads this same map and verifies the current `AgentState.owner` or `operator`. It returns `0` for an unregistered wallet, a retired/sentinel mapping, a missing agent record, a payout-only address, or a stale role mapping. It does not scan IDs or create a second identity store. The view identifies inactive agents but does not grant them challenge authorization.

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

- `_fetch_evidence` line 307; `_semantic_consensus` line 389.
- `_policy_limit` line 267; `_snapshot_hash` line 121.
- `publish_attestation` line 654; `evaluate_challenge` line 715.
- `register_agent` line 561; `update_agent` line 578; `submit_challenge` line 675.
- `_transfer` line 495; payment/reward/refund/remainder methods lines 812, 822, 842, and 865.
- `get_agent_by_wallet` line 889; the lookup shares `identity_agent_id` with registration and replacement.

## Local proof

`/private/tmp/veto-py312/bin/python -m pytest -q`: **39 passed**. This includes fabricated JSON/hash, false and genuine typed limits, context mismatch, mutable evidence, prompt injection, duplicate keys, attestation replay/expiry/context checks, identity attacks, wallet lookup, ordered settlement, failed/ambiguous transfers, replay protection, and accounting isolation.

Python 3.12 compilation and GenVM AST lint (3 checks) pass. The exact pinned runner is available in the official GenVM Manager `v0.6.0-rc6` bundle, but stock `genvm-lint check`, `validate`, and `schema` remain blocked with `E101`: the linter looks for `runners/py-genlayer/...<hash>.tar`, while the official bundle provides the exact runner as `.zip`. No replacement runner was used; full nondeterministic semantic/validator execution and live Studio Next ghost delivery remain unproven.

Frontend adapter/tests/build after the remediation pass: TypeScript passed, Vitest passed 91 tests across 11 files, ESLint passed with 0 errors and 15 existing warnings, Prettier passed, and the production build passed with advisory chunk-size/configuration warnings. The adapter supports the deployed lookup and a bounded fallback for the historical deployment; no funded transaction was performed.

The frontend adapter references the corrected 30-method interface, including `get_agent_by_wallet(wallet_address)`, and does not invent `get_agent_count()`. An unsupported-method response from an older deployment falls back only to a previously verified local association and then rechecks `get_agent`; it never scans transaction history or sequential IDs.

## Deployment and migration

Both deployed addresses retain their own state/code. The current 30-method deployment starts with fresh campaigns, agents, rewards, escrows, and pending claims; storage does not migrate automatically from either historical address. Live validator rounds, semantic validation through the stock tool, and real chain-level external-delivery tests remain unverified. Any frontend rollout must keep contract scopes isolated.

## Registration incident trace

The only transaction found from the reported wallet (`0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87`) to the current deployment was `0x9896d1dfe7ae93dc30f1422e78dc8cef3edc97f3c43362b6030b7a7d9848954d`. It finalized with `FINISHED_WITH_RETURN`, but decoded calldata was `{}` and the leader return payload was `null`; it was not a `register_agent` call. Read-only state confirmed `get_agent_by_wallet(wallet) == 0`, `get_campaign_count() == 0`, and zero global accounting, so no agent was registered.

An older deployment transaction, `0x896849a7e6c273bff8626c2f9c7ba9a88dcd840e779b9b9f239e8cdd594423af`, did encode `register_agent` with empty optional operator/payout fields, but its actual leader rollback was `[EXPECTED] owner already used` and its execution result was `FINISHED_WITH_ERROR`. That is consistent with the wallet already having an agent on the older deployment; the empty optional fields were not the reported runtime cause. These are distinct outcomes: the current candidate was a successful empty/no-op call, while the older call was a genuine duplicate-owner rejection. The production bundle inspected during this investigation embedded the current address and `register_agent` method, but Studio does not expose the user’s UI intent, so the available evidence cannot prove why the empty current call was created.

The frontend fix makes blank operator and payout fields explicit owner addresses, rejects malformed registration write arguments, reads returned IDs from GenLayer’s leader return payload rather than the top-level execution status code, and verifies the finalized wallet-to-agent mapping before navigation. Post-finality lookup failures are reported separately from transaction execution failure. No retry or live registration was performed.
