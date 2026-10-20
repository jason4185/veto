# VETO reviewer evidence report

## Scope and deployment safety

This report covers the current local [`contracts/Veto.py`](../contracts/Veto.py). The current deployed address `0x1F7df5eb0888c8B4628DC11895B8a90C7e3aF6Dd` and historical address `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8` were not modified. The current address exposes the wallet-lookup method and was checked read-only; no new deployment or GEN transaction was performed, and Vercel was not changed.

The remediation remains one VETO contract project. `docs/VETO_V2_ARCHITECTURE.md` is a retained design filename, not a second codebase.

## Executive status

| PAPITO concern | Local result | Proof boundary |
| --- | --- | --- |
| Fabricated evidence | **Partially remediated locally; not closed as independent proof** | Objective rules are deterministic; semantic rules require a one-time on-chain authority record. The authority is an explicit trust root, not a claim of decentralized real-world truth. |
| Owner/operator bypass | **Fixed locally; current interface read-verified** | One shared identity reservation map covers registration, replacement, retired operators, active status, participation, and direct wallet lookup. Person-level Sybil across unrelated wallets remains impossible to prevent here. |
| GEN transfer safety | **Not closed** | All four paths emit external ghost messages. Synchronous exceptions occur before one-way accounting changes, but neither this contract nor the installed client exposes an authenticated external-delivery receipt or safe recovery path. Studio cannot model the live ghost layer. |

## 1. Evidence integrity

### Original exploit

Before this remediation, an agent could host a 2xx JSON object on a permitted Netlify hostname with matching campaign/proposal/policy IDs and `violation: true`, invent `facts` and `statement`, calculate SHA-256 over those bytes, and submit the URL. `_fetch_evidence` validated structure and context, `_semantic_consensus` compared leader/validator outputs, and a `VALID` result could reserve and later pay the reward. The hash proved only the retrieved attacker bytes. HTTPS, Netlify hosting, and validator agreement did not prove authorship or truth.

The vulnerable trust boundary was the submitter-controlled `evidence_url` accepted by `submit_challenge` (line 675), fetched and hashed by `_fetch_evidence` (line 307), passed as untrusted text to `_semantic_consensus` (line 389), and previously used as a reward gate by challenge evaluation. The local regression tests retain the attack as negative tests: `test_fabricated_evidence_hash_is_only_a_hash_of_attacker_bytes` and `test_fabricated_netlify_record_cannot_reach_reward_without_authentication`.

### Actual local fix

* `MAX_PAYMENT_WEI:<decimal wei>` is parsed by `_policy_limit` (line 267), stored in `policy_limits` during `create_campaign`, and exposed as `limit_wei` / `policy_limit_wei`.
* `evaluate_challenge` (line 715) takes the typed path without fetching evidence or asking the model. It compares the stored proposal payment to the immutable limit. A genuine `8 GEN > 5 GEN` violation is `VALID` with `evidence_status=DETERMINISTIC`; a false claim below the limit is `INVALID` even if its JSON says `violation: true`.
* Semantic evaluation still uses `_semantic_consensus`, but `VALID` is reward-authorizing only when `publish_attestation` (line 654) was called by the configured deployment authority for the exact evidence digest and current snapshot. The snapshot includes chain ID, contract address, campaign/proposal IDs, recipient, payment amount, policy index/text, and typed limit. The key is one-time and the value is an expiry.
* `evaluate_challenge` recomputes the fetched response hash and current snapshot. Changed content, wrong context, another proposal, expired records, duplicate records, or prompt injection cannot reuse an attestation. Without a matching current record, a model `VALID` is converted to `INVALID` with `AUTH_REQUIRED`; no reward becomes claimable.

The authority is deliberately not the campaign creator. This prevents a creator from self-attesting their own campaign, but it does not prevent a compromised or colluding deployment authority from attesting false facts. That is the remaining trust-root risk and must be covered operationally or by a future audited authority registry/verifier. No unsupported GenVM signature-recovery API is claimed.

### Independent facts the contract can verify

The contract can verify its own chain/state facts: campaign and proposal IDs, exact policy text and typed limit, recipient, escrow amount, policy index, campaign creator, authority address, evidence URL syntax, HTTP/redirect/status/size/encoding properties, JSON schema/context, raw-byte SHA-256, attestation key binding, expiry, and leader/validator result shape. It cannot independently prove that a public web document is authored by a particular organization or that a real-world event happened. The authority record supplies an explicit trust decision for semantic facts; it does not magically make Netlify authoritative.

### Adversarial results

Covered by host emulation:

- fabricated valid JSON and correct false hash: no reward;
- false `violation` on a typed limit: deterministic `INVALID`;
- genuine 8 GEN versus 5 GEN: deterministic `VALID` and reward claimable;
- wrong IDs, redirects, malformed JSON, duplicate keys, mutable content, missing source, and prompt injection: no authenticated reward;
- authority-only attestation, duplicate/replay rejection, changed content, expiry, and context binding;
- semantic valid record with authority attestation: `AUTHENTICATED`.

These are mocked runtime tests. They prove the contract gate in the host model, not real-world source truth and not live validator/ghost behavior.

## Registration incident and frontend remediation

The only transaction found from the reported wallet (`0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87`) to the current deployment was `0x9896d1dfe7ae93dc30f1422e78dc8cef3edc97f3c43362b6030b7a7d9848954d`. It was `FINALIZED · ACCEPTED` with `FINISHED_WITH_RETURN`, but decoded calldata was `{}` and the leader return payload was `null`. It was therefore not a registration transaction and did not mutate agent state; `get_agent_by_wallet` returned `0` afterward.

For comparison, the older deployment transaction `0x896849a7e6c273bff8626c2f9c7ba9a88dcd840e779b9b9f239e8cdd594423af` encoded `register_agent` with empty optional operator/payout arguments, but its actual leader rollback was `[EXPECTED] owner already used` and its execution result was `FINISHED_WITH_ERROR`. This was a duplicate-owner rejection on the older deployment, not proof that empty optional fields caused the failure. The frontend now supplies explicit owner addresses when those fields are blank, rejects malformed registration adapter arguments, parses returned IDs from the GenLayer leader payload, performs the authoritative wallet lookup after finality, and separates post-finality verification errors from contract execution errors. The frontend regression suite is 91 passed across 11 files. No new live registration was submitted.

The production bundle inspected during this investigation embedded the current contract address and registration method. The chain does not retain the original UI state, so the exact client-side cause of the empty current call cannot be proven beyond the malformed calldata itself. The fix prevents the known blank-field path and makes future failures diagnosable without treating a successful no-op as registration success.

## 2. Identity security

`Veto` stores one `identity_agent_id` reservation for both owner and operator. `register_agent` (line 561) rejects an address already reserved in either role. `update_agent` (line 578) checks replacement operators before changing the reservation, permanently marks a retired delegated operator with `MAX_U256`, and allows only the agent’s own owner/operator transition. `_actor` and `submit_challenge` require the current authorized wallet and active agent.

`test_owner_and_operator_roles_share_one_identity_reservation` reproduces the cross-role attack. Other tests cover duplicate owners, operator replacement, retired operator reuse, inactive agents, activation, current operator participation, one submission per campaign, and reward authorization. One person controlling separate unrelated wallets remains an unavoidable Sybil limitation without an external identity authority.

### Direct wallet recognition

`get_agent_by_wallet(wallet_address)` uses the existing `identity_agent_id` map. It parses the supplied address, rejects a zero mapping, the `MAX_U256` retired-operator sentinel, and missing agent records, then verifies the live owner/operator fields before returning the ID. It returns `0` for not-found, retired, payout-only, or stale mappings; inactive agents remain discoverable but are still rejected by `submit_challenge`. No duplicate storage, history scan, sequential ID scan, or sender inference is used.

The host test `test_wallet_lookup_returns_only_current_owner_or_operator` covers owner, current operator, payout-only address, unregistered wallet, invalid address, inactive status, and replaced-operator invalidation. Frontend tests cover the on-chain result path, historical-contract fallback, wallet switching, stale local associations, and operator replacement. Cross-device recognition is expected only after the replacement exposing this view is deployed; the historical address cannot provide it.

## 3. GEN transfer safety

`_transfer` (line 495) is the sole emission boundary. `execute_proposal` (line 812), `claim_reward` (line 822), `claim_proposal_refund` (line 842), and `claim_campaign_remainder` (line 865) call it before changing paid/refunded/claimed flags, claim keys, or counters. In the host model, a synchronous exception leaves the obligation unchanged; successful retry is then one-way and duplicate calls are rejected.

Tests cover each of the four paths, recipient failure, repeated claims, replay after success, ambiguous emission, and accounting conservation. `test_ambiguous_transfer_is_not_retried_by_the_contract` intentionally leaves an obligation pending after an emission that reports no result. Blind retry is unsafe because the child may already exist.

The exact mechanism is an external message, not an internal IC message: `_Recipient` is decorated with `@gl.evm.contract_interface` (source line 405), and the pinned SDK’s EVM implementation lowers `emit_transfer` to `EmitExternalMessage` (`genlayer/_internal/on_chain/eth.py`, `perform_send`, lines 32–42). VETO calls that boundary only from `_transfer` (line 495), which is used by `execute_proposal` (812), `claim_reward` (822), `claim_proposal_refund` (842), and `claim_campaign_remainder` (865).

The official [message lifecycle](https://docs.genlayer.com/developers/intelligent-contracts/features/messages) says external messages cross to the EVM/chain layer, execute through the IC ghost via `handleOp`, and execute only on finalization. The official [value-transfer](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers) page says the IC balance is held by the ghost on the live network and that Studio has no EVM layer or ghost contracts. The installed GenLayerJS client’s `getTriggeredTransactionIds` implementation only discovers `InternalMessageProcessed` logs on network backends; it does not authenticate external `handleOp` delivery. The installed protocol ABI exposes `flushExternalMessages`, `getPendingTransactionValue`, and an `executeMessage(...)->bool` primitive, but this contract has no callback, receipt oracle, or safe way to correlate those operations with its four accounting records.

Read-only inspection of the current official Studio/chain source makes the layers explicit: the chain `ConsensusMain.finalizeTransaction` path invokes external-message processing; the messages contract calls the consensus `executeMessage` primitive; the consensus implementation performs a low-level recipient call and returns a boolean; the ghost `handleOp` implementation calls the destination with value and requires success. That is useful failure-path source evidence, but it is not a live Studio Next receipt and does not specify where value is recoverable after a failed external delivery. Studio instead represents `EthSend` as an `is_eth_send` pending transaction and updates its local account database, so a passing Studio SEND simulation is not proof of ghost-layer delivery.

Accordingly, a FINALIZED parent proves the parent IC execution, not successful delivery of every external GEN message. The available documentation and SDK do not establish where a failed external value is recoverable, whether an unsuccessful `executeMessage` is retried, or whether a later retry is idempotent. This report does **not** claim rollback, automatic refund, authenticated delivery, or safe retry. The contract deliberately performs no blind retry. The four payment paths therefore remain unsupported for a complete fund-safety guarantee for every external recipient until a real GenLayer chain test and protocol-level recovery specification establish those facts; Studio Next parent/ghost simulation is not enough.

## Accounting invariants

```text
reward_funded = reward_available + reward_reserved + reward_claimable
              + reward_paid + reward_refunded
escrow_funded = escrow_locked + escrow_paid + escrow_refunded
```

Host tests reconcile these ledgers after normal settlement, invalid/inconclusive/expired findings, reward claims, proposal refunds, cleared payments, campaign remainder recovery, failed synchronous transfers, and duplicate attempts. This is internal conservation; it is not proof of external child delivery.

## Local verification record

- Contract host/static suite: **39 passed** (`/private/tmp/veto-py312/bin/python -m pytest -q`).
- Python compilation: passed.
- `genvm-lint lint contracts/Veto.py --json`: passed, 3 AST checks.
- The exact pinned runner is locally present in the official GenVM Manager `v0.6.0-rc6` universal bundle (`sha256:bd30580f911338d5533460eca8ed714dec371de5803c04e41dbb96430aea7b6e`; extracted runner ZIP `sha256:2cbcc8389744c4321852d2c0b4bfcef0729bfd22467e2aaf0d4d204cf6f015eb`). The official arm64 macOS execution bundle matches the release `SHA256SUMS` (`sha256:25995423dedb468d5d70673759e90dfaf33fe1b455982c343c2795952ae5e312`). The bundled executor and manager install checks passed. A prior exact-runner sequence completed **20 successful GenVM calls with 0 manager failures** for the unchanged lifecycle, typed-policy, attestation, identity, and external-message paths. This is exact local GenVM execution, not validator consensus or live ghost delivery, and it predates the new wallet-lookup method. Preliminary harness failures were corrected fee-schema/balance setup errors and were not counted as contract failures. Stock `genvm-lint check` remains blocked by its `E101` lookup for a `.tar` runner member even though the official current bundle contains the exact `.zip`; this is not full nondeterministic semantic/validator validation.
- Direct/integration Studio harness: unavailable (`gltest` and `gltest.config.yaml` absent).
- Existing-deployment read verification for `0x1F7df5...` confirmed `get_config`, `get_campaign_count`, `get_global_accounting`, `get_agent_by_wallet`, and the 30-method reflected interface. No deployment receipt hash, validator round, native GEN receipt, child transfer, or funded transaction was supplied or executed in this worktree.
- Pinned GenVM validation: AST lint passed; exact manager/executor execution passed for deterministic and emission cases listed above. The official bundle contains `runners/py-genlayer/5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng.zip`. Stock `genvm-lint validate`, `schema`, `setup`, and `check` cannot consume the current `.zip` layout (`E101`, missing `.tar` member), so nondeterministic semantic validation through the stock tool remains unproven. No other runner was substituted.
- Frontend: TypeScript passed; Vitest **91 passed across 11 files**; ESLint passed with 0 errors and 15 existing warnings; Prettier and production build passed with advisory chunk/configuration warnings.

## Contract artifact

- Final local size: **51,986 UTF-8 bytes**; 14 bytes below the 52,000-byte limit.
- Final local SHA-256: **`6041e7b033e9ab619e784412fce3becc9ce1214e850d09375ee3aca784b3016d`**.
- Old deployed address: `0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8` (unchanged).
- Current deployed address: `0x1F7df5eb0888c8B4628DC11895B8a90C7e3aF6Dd`; deployment transaction hash was not supplied.

## PAPITO response draft

The fabricated-evidence finding is remediated at the reward boundary for typed objective policies in the local source, but is not closed as independent proof for semantic policies. Typed objective policies are settled from immutable on-chain values and ignore attacker JSON. Semantic policies retain GenLayer evaluation but require a one-time authority attestation bound to the exact chain, contract, proposal snapshot, policy, evidence hash, and expiry. A valid hash or validator agreement alone cannot authorize GEN. This is an explicit single-authority trust model, not cryptographic proof of public-source truth: a compromised or colluding authority can still authorize a false digest. The local source awaits manual deployment; no funded lifecycle or external delivery proof exists.

The owner/operator bypass is fixed with one shared reservation map, including replacement and retired-operator checks. Local adversarial tests pass. Separate wallets controlled by one person remain outside the contract’s identity model.

Transfer handling is improved synchronously: state is committed only after `_transfer` returns, so host-mode failures are retryable and successful parent executions are single-use. GenLayer external ghost delivery, failed `handleOp` behavior, delivery receipts, and value recovery are not proven by the local source, installed client, or Studio. No automatic retry is claimed. A real chain-level test and protocol-supported recovery design are required before calling fund safety complete.
