import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { TrackedStatus } from "@genlayer/transaction-kit";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, ShieldCheck, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractAction } from "@/components/veto/actions";
import {
  campaignLabel,
  agentControlsWallet,
  chainConfig,
  challengeEvaluationAvailable,
  connectionState,
  formatDuration,
  formatGen,
  isAddress,
  positiveGen,
  requiredCampaignFunding,
  preflightEvidence,
  utf8Bytes,
  VETO_LIMITS,
  validateCampaignDuration,
  validateEvidence,
  isContractId,
} from "@/lib/veto/domain";
import {
  addProposalWrite,
  createCampaignWrite,
  getCampaign,
  getAgent,
  getAgentByWallet,
  getAgentCampaignParticipation,
  getProposal,
  registerAgentWrite,
  simpleWrite,
  submitChallengeWrite,
  updateAgentWrite,
  type ContractWrite,
} from "@/lib/veto/contract";
import {
  useAgent,
  useCampaign,
  useChallenge,
  useMyCampaigns,
  useParticipation,
  useProposal,
  useVetoConfig,
  useWalletAgent,
  walletAgentQueryKey,
  invalidateVetoQueries,
  invalidationKeysForWrite,
} from "@/lib/veto/hooks";
import { useWallet } from "@/lib/veto/wallet";
import { pendingScope, usePendingTransactions } from "@/lib/veto/pending";
import { TransactionRunner, transactionResultId } from "@/lib/veto/transaction";
import { getVetoTransaction } from "@/lib/veto/client";
import { forgetKnownAgentId, rememberVerifiedAgent } from "@/lib/veto/agent-memory";
import {
  VetoErrorNotice,
  WalletGate,
  ConnectionNotice,
  PageControls,
  ReadFailure,
  ReadLoading,
  ReadNotFound,
} from "./shared";
import { normalizeVetoError, VetoError } from "@/lib/veto/errors";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Amount({ name, label, hint }: { name: string; label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="input-unit">
        <input
          aria-label={label}
          name={name}
          inputMode="decimal"
          placeholder="0.00"
          required
          autoComplete="off"
        />
        <span>GEN</span>
      </div>
    </Field>
  );
}

function WriteRunner({
  write,
  label,
  onDone,
  onError,
  onDismiss,
  onSubmitted,
  onAccepted,
  onFinalityError,
}: {
  write: ContractWrite | null;
  label: string;
  onDone: (txId: string) => void | Promise<void>;
  onError: (error: Error) => void;
  onDismiss?: () => void;
  onSubmitted?: (txId: string, status: TrackedStatus) => void | Promise<void>;
  onAccepted?: (txId: string, status: TrackedStatus) => void | Promise<void>;
  onFinalityError?: (error: Error) => void;
}) {
  const wallet = useWallet();
  if (!write || !wallet.kit || !wallet.connectedClient) return null;
  return (
    <TransactionRunner
      kit={wallet.kit}
      client={wallet.connectedClient}
      write={write}
      label={label}
      onSuccess={onDone}
      onError={onError}
      {...(onSubmitted ? { onSubmitted } : {})}
      {...(onAccepted ? { onAccepted } : {})}
      {...(onFinalityError ? { onFinalityError } : {})}
      {...(onDismiss ? { onDismiss } : {})}
    />
  );
}

function canWrite(wallet: ReturnType<typeof useWallet>) {
  return (
    connectionState === "ready" &&
    wallet.status === "connected" &&
    Boolean(wallet.address && wallet.kit && wallet.connectedClient)
  );
}

export function CreatorForm() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pendingTransactions = usePendingTransactions(pendingScope(wallet.address, wallet.chainId));
  const fundingPending = pendingTransactions.some((record) => record.method === "create_campaign");
  const configQuery = useVetoConfig();
  const config = configQuery.data;
  const minimumDuration = config?.minDuration ?? 3600;
  const maximumDuration = config?.maxDuration ?? 30 * 24 * 60 * 60;
  const durationOptions = Array.from(
    new Set([minimumDuration, 3600, 86400, 3 * 86400, 7 * 86400, maximumDuration]),
  )
    .filter((value) => value >= minimumDuration && value <= maximumDuration)
    .sort((left, right) => left - right);
  const [error, setError] = useState<unknown>();
  const [review, setReview] = useState<{
    name: string;
    description: string;
    policies: string[];
    maxAgents: number;
    reward: bigint;
    funding: bigint;
    durationSeconds: number;
  }>();
  const [confirmed, setConfirmed] = useState(false);
  const [write, setWrite] = useState<ContractWrite | null>(null);
  const [txId, setTxId] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setConfirmed(false);
    setTxId("");
    const form = new FormData(event.currentTarget);
    try {
      const name = String(form.get("name") ?? "").trim();
      const description = String(form.get("description") ?? "").trim();
      const policies = String(form.get("policies") ?? "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
      const maxAgents = Number(form.get("maxAgents"));
      const reward = positiveGen(String(form.get("reward") ?? ""));
      const durationSeconds = Number(form.get("durationSeconds"));
      if (!name || !description) throw new Error("Enter a campaign name and description.");
      if (!policies.length || policies.length > 8)
        throw new Error("Provide between 1 and 8 non-empty policy lines.");
      if (utf8Bytes(name) > VETO_LIMITS.nameBytes)
        throw new Error("Campaign name is too long for the contract.");
      if (utf8Bytes(description) > VETO_LIMITS.descriptionBytes)
        throw new Error("Campaign description is too long for the contract.");
      if (utf8Bytes(policies.join("\n")) > VETO_LIMITS.policiesBytes)
        throw new Error("Policy text is too long for the contract.");
      if (policies.some((policy) => utf8Bytes(policy) > VETO_LIMITS.policyBytes))
        throw new Error("Each policy line is too long for the contract.");
      if (
        !Number.isSafeInteger(maxAgents) ||
        maxAgents < 1 ||
        maxAgents > (config?.maxAgents ?? 1000)
      )
        throw new Error(`Choose between 1 and ${config?.maxAgents ?? 1000} participating agents.`);
      validateCampaignDuration(durationSeconds, config);
      const funding = requiredCampaignFunding(maxAgents, reward);
      setReview({ name, description, policies, maxAgents, reward, funding, durationSeconds });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please check the form.");
    }
  };
  const submitWrite = async () => {
    if (!review || write || wallet.busy) return;
    if (fundingPending) {
      setError("A previous campaign funding transaction is still awaiting finality.");
      return;
    }
    setError(undefined);
    if (connectionState !== "ready") {
      setError("The VETO contract is unavailable right now. Please try again shortly.");
      return;
    }
    if (wallet.status === "disconnected") {
      await wallet.connect();
      return;
    }
    if (wallet.status === "wrong-network") {
      await wallet.switchToStudioNext();
      return;
    }
    if (!canWrite(wallet)) {
      setError("Connect your wallet to fund this competition.");
      return;
    }
    try {
      setWrite(
        createCampaignWrite({
          name: review.name,
          description: review.description,
          policies: review.policies,
          maxAgents: review.maxAgents,
          reward: review.reward,
          durationSeconds: review.durationSeconds,
        }),
      );
    } catch (reason) {
      setError(reason);
    }
  };
  return (
    <div className="form-layout">
      <form className="veto-form" onSubmit={submit}>
        <div className="form-section">
          <h2 className="form-section-title">01 / Campaign details</h2>
          <Field label="Campaign name">
            <input
              aria-label="Campaign name"
              name="name"
              maxLength={VETO_LIMITS.nameBytes}
              required
              placeholder="Give your audit a name"
            />
          </Field>
          <Field
            label="Description"
            hint="Describe the scope of governance your agents will investigate."
          >
            <textarea
              aria-label="Description"
              name="description"
              maxLength={VETO_LIMITS.descriptionBytes}
              required
              placeholder="What should agents pay attention to?"
            />
          </Field>
        </div>
        <div className="form-section">
          <h2 className="form-section-title">02 / Governing policy</h2>
          <Field
            label="Policy lines"
            hint="One policy per line. Use MAX_PAYMENT_WEI:<wei> for a deterministic on-chain payment cap; other rules require authority-authenticated evidence before rewards."
          >
            <textarea
              aria-label="Policy lines"
              name="policies"
              maxLength={VETO_LIMITS.policiesBytes}
              required
              rows={5}
              placeholder={
                "Define a clear, verifiable rule.\nAdd the evidence needed to check compliance."
              }
            />
          </Field>
        </div>
        <div className="form-section">
          <h2 className="form-section-title">03 / Fixed competition terms</h2>
          <div className="form-grid">
            <Field
              label="Maximum participating agents"
              hint={`The contract allows 1–${config?.maxAgents ?? 1000}. Each participant gets one campaign submission.`}
            >
              <input
                aria-label="Maximum participating agents"
                name="maxAgents"
                type="number"
                min="1"
                max={config?.maxAgents ?? 1000}
                step="1"
                defaultValue="10"
                required
              />
            </Field>
            <Amount
              name="reward"
              label="Reward per accepted winner"
              hint="Immutable after launch. Not every participant is guaranteed a reward."
            />
          </div>
          <Field
            label="Campaign duration"
            hint={`Allowed: ${formatDuration(minimumDuration)} to ${formatDuration(maximumDuration)}. Intake closes at the deadline or when the cap fills.`}
          >
            <select
              aria-label="Campaign duration"
              name="durationSeconds"
              defaultValue={String(durationOptions[1] ?? durationOptions[0] ?? minimumDuration)}
              required
            >
              {durationOptions.map((value) => (
                <option key={value} value={value}>
                  {formatDuration(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <WalletGate />
        {Boolean(error) && <VetoErrorNotice error={error} />}
        <div className="form-submit">
          <p>Reviewing does not create a campaign or move GEN.</p>
          <Button type="submit">
            Review fixed budget <ArrowRight />
          </Button>
        </div>
        {review && (
          <section className="review" aria-live="polite">
            <p className="eyebrow">TRANSACTION REVIEW · NOT SUBMITTED</p>
            <h3 className="mt-4">{review.name}</h3>
            <p className="text-sm text-muted-foreground mb-6">{review.description}</p>
            <dl>
              <dt>Maximum agents</dt>
              <dd>{review.maxAgents}</dd>
              <dt>Reward per accepted winner</dt>
              <dd>{formatGen(review.reward)} GEN</dd>
              <dt>Total required funding</dt>
              <dd>{formatGen(review.funding)} GEN</dd>
              <dt>Campaign duration</dt>
              <dd>{formatDuration(review.durationSeconds)}</dd>
              <dt>Estimated deadline</dt>
              <dd>{new Date(Date.now() + review.durationSeconds * 1000).toLocaleString()}</dd>
              <dt>Network</dt>
              <dd>
                {chainConfig.name} · {wallet.address ?? "Connect wallet"}
              </dd>
            </dl>
            <div className="detail-block">
              <h3>Policy review</h3>
              {review.policies.map((policy, index) => (
                <p key={policy}>
                  {index + 1}. {policy}
                </p>
              ))}
            </div>
            <div className="review-warning">
              <strong>Fixed-budget competition.</strong>
              <p>
                The contract requires exactly maximum agents × reward per accepted winner. A
                rejected submission consumes its participant slot, but only finalized winning
                findings earn GEN. Additional funding requires a new campaign.
              </p>
              <p>
                The deadline preview is estimated from the current browser clock; the contract
                calculates the final deadline from the transaction timestamp.
              </p>
            </div>
            <label className="review-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I have checked the immutable terms and exact GEN funding.
            </label>
            <Button
              type="button"
              disabled={!confirmed || wallet.busy || Boolean(write) || fundingPending}
              onClick={() => void submitWrite()}
            >
              <LockKeyhole />
              {wallet.busy
                ? "Connecting wallet…"
                : fundingPending
                  ? "Campaign funding pending"
                  : wallet.status === "disconnected"
                    ? "Connect wallet to fund"
                    : wallet.status === "wrong-network"
                      ? "Switch to Studio Next"
                      : canWrite(wallet)
                        ? "Confirm & fund campaign"
                        : "Connect contract and wallet to fund"}
            </Button>
            {txId && (
              <p className="text-xs text-muted-foreground mt-4">Transaction finalized: {txId}</p>
            )}
            <WriteRunner
              write={write}
              label="Create campaign"
              onDone={async (id) => {
                setTxId(id);
                setWrite(null);
                const client = wallet.connectedClient;
                if (!client) {
                  setError(
                    "Campaign funding finalized, but the wallet client disconnected before the new campaign could be verified.",
                  );
                  return;
                }
                try {
                  const receipt = await getVetoTransaction(client, id);
                  const campaignId = transactionResultId(receipt);
                  if (!campaignId) {
                    setError(
                      "Campaign funding finalized, but Studio Next did not return a verifiable campaign ID. Open the dashboard to continue.",
                    );
                    return;
                  }
                  const campaign = await getCampaign(campaignId, client);
                  if (campaign.id !== campaignId) {
                    setError(
                      "Campaign funding finalized, but the returned campaign ID could not be verified on-chain.",
                    );
                    return;
                  }
                  await invalidateVetoQueries(
                    queryClient,
                    invalidationKeysForWrite(write, queryClient, {
                      address: wallet.address,
                      chainId: wallet.chainId,
                    }),
                  );
                  await navigate({ to: "/campaign/$id", params: { id: campaignId } });
                } catch (reason) {
                  setError(reason);
                }
              }}
              onError={(reason) => {
                setError(reason);
                setWrite(null);
              }}
              onDismiss={() => setWrite(null)}
            />
          </section>
        )}
      </form>
      <aside className="form-aside">
        <ShieldCheck size={25} strokeWidth={1} />
        <h3>Fund the competition once.</h3>
        <p>
          VETO fixes the total reward budget at launch: maximum agents multiplied by the reward per
          accepted winner.
        </p>
        <ul>
          <li>One campaign submission per agent.</li>
          <li>Only accepted winners earn GEN.</li>
          <li>Unused rewards remain protected until closure.</li>
          <li>Proposal escrow is funded separately.</li>
        </ul>
        <div className="aside-divider" />
        <p>
          Evidence is evaluated as soon as the transaction can be processed. Winner priority follows
          onchain submission order, not evaluation order.
        </p>
        <Link to="/how-it-works" className="text-link">
          Read the full lifecycle <ArrowUpRight size={14} />
        </Link>
      </aside>
    </div>
  );
}

export function RegisterAgentForm() {
  type RegistrationStatus =
    | "idle"
    | "review"
    | "awaiting_approval"
    | "submitted"
    | "accepted"
    | "finalized_verifying"
    | "finalized_success"
    | "contract_rejected"
    | "transaction_failed"
    | "rpc_error"
    | "verification_failed";
  const wallet = useWallet();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [review, setReview] = useState<{
    name: string;
    description: string;
    operator: string;
    payout: string;
  }>();
  const [confirmed, setConfirmed] = useState(false);
  const [write, setWrite] = useState<ContractWrite | null>(null);
  const [txId, setTxId] = useState("");
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>("idle");
  const statusLabel: Record<RegistrationStatus, string> = {
    idle: "REGISTRATION",
    review: "REGISTRATION REVIEW · NOT SUBMITTED",
    awaiting_approval: "REGISTRATION TRANSACTION · AWAITING WALLET APPROVAL",
    submitted: "REGISTRATION TRANSACTION · SUBMITTED",
    accepted: "REGISTRATION TRANSACTION · ACCEPTED — AWAITING FINALITY",
    finalized_verifying: "REGISTRATION FINALIZED · VERIFYING ON-CHAIN STATE",
    finalized_success: "REGISTRATION FINALIZED · VERIFIED",
    contract_rejected: "REGISTRATION REJECTED BY CONTRACT",
    transaction_failed: "REGISTRATION TRANSACTION FAILED",
    rpc_error: "REGISTRATION STATUS UNAVAILABLE",
    verification_failed: "REGISTRATION FINALIZED · VERIFICATION FAILED",
  };
  const registrationFailureStatus = (reason: unknown): RegistrationStatus => {
    const kind = normalizeVetoError(reason).kind;
    if (kind === "wallet_rejected") return "review";
    if (kind === "rate_limited" || kind === "rpc_unavailable" || kind === "configuration")
      return "rpc_error";
    if (kind === "authorization" || kind === "contract_state" || kind === "validation")
      return "contract_rejected";
    if (kind === "insufficient_gen" || kind === "unknown") return "transaction_failed";
    return "transaction_failed";
  };
  const finalizedVerificationError = (message: string, reason?: unknown) => {
    const normalized = reason ? normalizeVetoError(reason) : undefined;
    return new VetoError(
      message,
      normalized?.kind ?? "contract_state",
      normalized?.technicalMessage ?? message,
      "Keep the transaction hash and retry the authoritative on-chain verification read.",
    );
  };
  useEffect(() => {
    setReview(undefined);
    setConfirmed(false);
    setWrite(null);
    setError(undefined);
    setTxId("");
    setRegistrationStatus("idle");
  }, [wallet.address]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setTxId("");
    setWrite(null);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const operator = String(form.get("operator") ?? "").trim();
    const payout = String(form.get("payout") ?? "").trim();
    if (!wallet.address) return setError("Connect the owner wallet before registering an agent.");
    if (!name || !description) return setError("Enter an agent name and description.");
    if (utf8Bytes(name) > VETO_LIMITS.nameBytes)
      return setError("Agent name is too long for the contract.");
    if (utf8Bytes(description) > VETO_LIMITS.descriptionBytes)
      return setError("Agent description is too long for the contract.");
    if (operator && !isAddress(operator)) return setError("Operator must be a valid 0x address.");
    if (payout && !isAddress(payout)) return setError("Payout must be a valid 0x address.");
    setReview({
      name,
      description,
      operator: operator || wallet.address,
      payout: payout || wallet.address,
    });
    setConfirmed(false);
    setRegistrationStatus("review");
  };
  return (
    <div className="form-layout">
      <form className="veto-form" onSubmit={submit}>
        <h2 className="form-section-title">Register an agent</h2>
        <Field label="Agent name">
          <input
            aria-label="Agent name"
            name="name"
            maxLength={VETO_LIMITS.nameBytes}
            placeholder="Your agent’s name"
            required
          />
        </Field>
        <Field label="Description" hint="The caller’s wallet becomes the immutable owner identity.">
          <textarea
            aria-label="Agent description"
            name="description"
            maxLength={VETO_LIMITS.descriptionBytes}
            required
            placeholder="What does this agent investigate?"
          />
        </Field>
        <Field
          label="Operator address"
          hint="Leave blank to use the owner. Operator identities cannot be reused after retirement."
        >
          <input
            aria-label="Operator address"
            name="operator"
            placeholder="Same as connected owner"
          />
        </Field>
        <Field
          label="Payout address"
          hint="Leave blank to pay the owner. This is where a finalized reward is sent."
        >
          <input aria-label="Payout address" name="payout" placeholder="Same as connected owner" />
        </Field>
        <WalletGate />
        {Boolean(error) && <VetoErrorNotice error={error} />}
        <Button type="submit">
          Review registration <ArrowRight />
        </Button>
        {review && (
          <section className="review">
            <p className="eyebrow">{statusLabel[registrationStatus]}</p>
            <h3 className="mt-4">{review.name}</h3>
            <dl>
              <dt>Owner</dt>
              <dd>{wallet.address}</dd>
              <dt>Operator</dt>
              <dd>{review.operator || wallet.address}</dd>
              <dt>Payout</dt>
              <dd>{review.payout || wallet.address}</dd>
            </dl>
            <div className="review-warning">
              <strong>One owner identity per wallet.</strong>
              <p>
                Registering creates one agent for the connected owner. Separate wallets cannot be
                proven to belong to different people.
              </p>
            </div>
            <label className="review-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I understand registration does not guarantee participation or rewards.
            </label>
            <Button
              type="button"
              disabled={!confirmed || !canWrite(wallet) || Boolean(write)}
              onClick={() => {
                setError(undefined);
                setRegistrationStatus("awaiting_approval");
                setWrite(
                  registerAgentWrite(
                    review.name,
                    review.description,
                    review.operator,
                    review.payout,
                  ),
                );
              }}
            >
              {write
                ? "Registration in progress"
                : canWrite(wallet)
                  ? "Register agent"
                  : "Connect contract and wallet"}
            </Button>
            {txId && (
              <p className="text-xs text-muted-foreground mt-4">
                Transaction {registrationStatus === "finalized_success" ? "finalized" : "ID"}:{" "}
                {txId}
              </p>
            )}
            <WriteRunner
              write={write}
              label="Register agent"
              onSubmitted={(id) => {
                setTxId(id);
                setRegistrationStatus("submitted");
              }}
              onAccepted={(id) => {
                setTxId(id);
                setRegistrationStatus("accepted");
              }}
              onDone={async (id) => {
                setTxId(id);
                setRegistrationStatus("finalized_verifying");
                setWrite(null);
                const client = wallet.connectedClient;
                if (!client) {
                  setRegistrationStatus("verification_failed");
                  setError(
                    finalizedVerificationError(
                      "Registration finalized, but the wallet client disconnected before the new agent ID could be verified.",
                    ),
                  );
                  return;
                }
                if (!wallet.address) {
                  setRegistrationStatus("verification_failed");
                  setError(
                    finalizedVerificationError(
                      "Registration finalized, but the owner wallet disconnected before the new agent could be verified.",
                    ),
                  );
                  return;
                }
                let verifiedAgentId: string | undefined;
                try {
                  const receipt = await getVetoTransaction(client, id);
                  const returnedAgentId = transactionResultId(receipt);
                  let agentId: string | undefined;
                  try {
                    agentId = await getAgentByWallet(wallet.address, client);
                  } catch (reason) {
                    if (!returnedAgentId) throw reason;
                    agentId = returnedAgentId;
                  }
                  if (!agentId) {
                    setRegistrationStatus("verification_failed");
                    setError(
                      finalizedVerificationError(
                        "Registration finalized, but no agent is currently registered for this wallet. The transaction result could not be reconciled with contract state.",
                      ),
                    );
                    return;
                  }
                  if (returnedAgentId && returnedAgentId !== agentId) {
                    setRegistrationStatus("verification_failed");
                    setError(
                      finalizedVerificationError(
                        "Registration finalized, but the receipt and wallet lookup returned different agent IDs.",
                      ),
                    );
                    return;
                  }
                  const registeredAgent = await getAgent(agentId, client);
                  if (registeredAgent.id !== agentId) {
                    setRegistrationStatus("verification_failed");
                    setError(
                      finalizedVerificationError(
                        "Registration finalized, but the returned agent ID could not be verified on-chain.",
                      ),
                    );
                    return;
                  }
                  if (
                    !wallet.address ||
                    registeredAgent.owner.toLowerCase() !== wallet.address.toLowerCase()
                  ) {
                    setRegistrationStatus("verification_failed");
                    setError(
                      finalizedVerificationError(
                        "Registration finalized, but the returned agent is not owned by the registering wallet.",
                      ),
                    );
                    return;
                  }
                  if (!rememberVerifiedAgent(registeredAgent, agentId)) {
                    setError(
                      "Registration finalized, but this browser could not save the verified owner/operator association.",
                    );
                  }
                  queryClient.setQueryData(walletAgentQueryKey(wallet.address, wallet.chainId), {
                    agent: registeredAgent,
                    source: "onchain" as const,
                  });
                  setRegistrationStatus("finalized_success");
                  verifiedAgentId = agentId;
                } catch (reason) {
                  setRegistrationStatus("verification_failed");
                  setError(
                    finalizedVerificationError(
                      "Registration finalized, but the on-chain agent record could not be verified. The transaction was not reclassified as a contract revert.",
                      reason,
                    ),
                  );
                }
                if (verifiedAgentId)
                  await navigate({ to: "/agent/$id", params: { id: verifiedAgentId } });
              }}
              onError={(reason) => {
                setError(reason);
                setRegistrationStatus(registrationFailureStatus(reason));
                setWrite(null);
              }}
              onFinalityError={(reason) => {
                setError(reason);
                setRegistrationStatus(registrationFailureStatus(reason));
                setWrite(null);
              }}
              onDismiss={() => {
                setWrite(null);
                if (registrationStatus === "awaiting_approval") setRegistrationStatus("review");
              }}
            />
          </section>
        )}
      </form>
      <aside className="form-aside">
        <p className="eyebrow">INDEPENDENT BY DESIGN</p>
        <h3>Identity. Evidence. Accountability.</h3>
        <p>
          Registration lets an authorized owner or operator submit one challenge in each campaign.
        </p>
        <div className="aside-divider" />
        <p>
          Deactivation does not reset participation. Replacing an operator does not create a fresh
          identity.
        </p>
      </aside>
    </div>
  );
}

export function UpdateAgentForm({
  agent,
}: {
  agent: {
    id: string;
    owner: string;
    name: string;
    description: string;
    operator: string;
    payoutAddress: string;
    active: boolean;
  };
}) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>();
  const [write, setWrite] = useState<ContractWrite | null>(null);
  const [txId, setTxId] = useState("");
  const owner = Boolean(
    wallet.address && wallet.address.toLowerCase() === agent.owner.toLowerCase(),
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const operator = String(form.get("operator") ?? "").trim();
    const payout = String(form.get("payout") ?? "").trim();
    const active = form.get("active") === "on";
    if (!owner) return setError("Only the registered owner can update this agent.");
    if (!name || !description) return setError("Enter an agent name and description.");
    if (utf8Bytes(name) > VETO_LIMITS.nameBytes)
      return setError("Agent name is too long for the contract.");
    if (utf8Bytes(description) > VETO_LIMITS.descriptionBytes)
      return setError("Agent description is too long for the contract.");
    if (operator && !isAddress(operator)) return setError("Operator must be a valid 0x address.");
    if (payout && !isAddress(payout)) return setError("Payout must be a valid 0x address.");
    setWrite(updateAgentWrite(agent.id, name, description, operator, payout, active));
  };
  return (
    <form className="veto-form mt-6" onSubmit={submit}>
      <h3>Update agent profile</h3>
      <Field label="Agent name">
        <input
          aria-label="Updated agent name"
          name="name"
          defaultValue={agent.name}
          maxLength={VETO_LIMITS.nameBytes}
          required
        />
      </Field>
      <Field label="Description">
        <textarea
          aria-label="Updated agent description"
          name="description"
          defaultValue={agent.description}
          maxLength={VETO_LIMITS.descriptionBytes}
          required
        />
      </Field>
      <Field
        label="Operator address"
        hint="Changing operators does not reset this agent’s campaign participation."
      >
        <input
          aria-label="Updated operator address"
          name="operator"
          defaultValue={agent.operator}
        />
      </Field>
      <Field label="Payout address">
        <input
          aria-label="Updated payout address"
          name="payout"
          defaultValue={agent.payoutAddress}
        />
      </Field>
      <label className="review-confirm">
        <input type="checkbox" name="active" defaultChecked={agent.active} />
        Agent is active for future challenge submissions.
      </label>
      {Boolean(error) && <VetoErrorNotice error={error} />}
      <Button type="submit" disabled={!owner || !canWrite(wallet)}>
        {owner && canWrite(wallet) ? "Review profile update" : "Owner wallet and contract required"}
      </Button>
      {write && (
        <WriteRunner
          write={write}
          label="Update agent"
          onDone={async (id) => {
            setTxId(id);
            setWrite(null);
            const client = wallet.connectedClient;
            if (!client) {
              setError(
                "Agent update finalized, but the wallet client disconnected before verification.",
              );
              return;
            }
            try {
              const updatedAgent = await getAgent(agent.id, client);
              if (
                updatedAgent.owner.toLowerCase() !== agent.owner.toLowerCase() ||
                updatedAgent.id !== agent.id
              ) {
                throw new Error(
                  "Agent update finalized, but the live owner record could not be verified.",
                );
              }
              if (!rememberVerifiedAgent(updatedAgent, agent.id)) {
                setError(
                  "Agent update finalized, but this browser could not save the verified owner/operator association.",
                );
              }
              if (
                agent.operator.toLowerCase() !== updatedAgent.operator.toLowerCase() &&
                agent.operator.toLowerCase() !== updatedAgent.owner.toLowerCase()
              ) {
                forgetKnownAgentId(agent.operator);
              }
              await invalidateVetoQueries(
                queryClient,
                invalidationKeysForWrite(write, queryClient, {
                  address: wallet.address,
                  chainId: wallet.chainId,
                }),
              );
            } catch (reason) {
              setError(reason);
            }
          }}
          onError={(reason) => {
            setError(reason);
            setWrite(null);
          }}
          onDismiss={() => setWrite(null)}
        />
      )}
      {txId && <p className="text-xs text-muted-foreground mt-4">Transaction finalized: {txId}</p>}
    </form>
  );
}

export function ChallengeForm({ proposalId }: { proposalId: string }) {
  const wallet = useWallet();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const proposalQuery = useProposal(proposalId);
  const proposal = proposalQuery.data;
  const campaignQuery = useCampaign(proposal?.campaignId ?? "");
  const campaign = campaignQuery.data;
  const [agentId, setAgentId] = useState("");
  const [manualAgentSelection, setManualAgentSelection] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [preflight, setPreflight] = useState<{ tone: "success" | "error"; message: string }>();
  const [preflightBusy, setPreflightBusy] = useState(false);
  const participationQuery = useParticipation(agentId, proposal?.campaignId ?? "");
  const participation = participationQuery.data;
  const [error, setError] = useState<unknown>();
  const [review, setReview] = useState<{ allegation: string; explanation: string; url: string }>();
  const [confirmed, setConfirmed] = useState(false);
  const [write, setWrite] = useState<ContractWrite | null>(null);
  const [txId, setTxId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const challengeQuery = useChallenge(challengeId);
  const recordedChallenge = challengeQuery.data;
  const walletAgentQuery = useWalletAgent(wallet.address, wallet.chainId);
  const discoveredAgent = walletAgentQuery.data?.agent;
  const agentQuery = useAgent(manualAgentSelection ? agentId : "");
  const agent = manualAgentSelection ? agentQuery.data : discoveredAgent;
  const agentIdIsValid = isContractId(agentId);
  const proposalReadPending = proposalQuery.isPending && !proposal;
  const campaignReadPending = Boolean(proposal) && campaignQuery.isPending && !campaign;
  const automaticAgentReadPending =
    !manualAgentSelection &&
    Boolean(wallet.address) &&
    walletAgentQuery.isPending &&
    !discoveredAgent;
  const automaticAgentReadError =
    !manualAgentSelection && Boolean(wallet.address) && walletAgentQuery.isError
      ? walletAgentQuery.error
      : undefined;
  const agentReadPending = manualAgentSelection && agentIdIsValid && agentQuery.isPending && !agent;
  const participationReadPending =
    agentIdIsValid &&
    Boolean(proposal?.campaignId) &&
    participationQuery.isPending &&
    !participation;
  const eligibilityReadError =
    proposalQuery.error ??
    (proposal ? campaignQuery.error : undefined) ??
    automaticAgentReadError ??
    (manualAgentSelection && agentIdIsValid ? agentQuery.error : undefined) ??
    (agentIdIsValid && proposal?.campaignId ? participationQuery.error : undefined);
  const eligibilityReadPending =
    proposalReadPending ||
    campaignReadPending ||
    automaticAgentReadPending ||
    agentReadPending ||
    participationReadPending;
  const authorized = Boolean(
    wallet.address && agent && agent.active && agentControlsWallet(agent, wallet.address),
  );
  useEffect(() => {
    setManualAgentSelection(false);
    setAgentId("");
    setError(undefined);
    setReview(undefined);
    setChallengeId("");
  }, [wallet.address, wallet.chainId, wallet.status]);
  useEffect(() => {
    if (!manualAgentSelection) setAgentId(discoveredAgent?.id ?? "");
  }, [discoveredAgent?.id, manualAgentSelection]);
  const eligible = Boolean(
    !eligibilityReadError &&
    !eligibilityReadPending &&
    proposal &&
    campaign &&
    campaign.intakeOpen &&
    campaign.remainingAgentSlots > 0 &&
    ["OPEN", "PENDING"].includes(proposal.stage) &&
    proposal.challengeCount < VETO_LIMITS.challengesPerProposal &&
    authorized &&
    !participation?.participated,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setTxId("");
    const form = new FormData(event.currentTarget);
    const url = evidenceUrl.trim();
    const allegation = String(form.get("allegation") ?? "").trim();
    const explanation = String(form.get("explanation") ?? "").trim();
    if (eligibilityReadError)
      return setError("On-chain eligibility could not be verified. Retry the failed read.");
    if (eligibilityReadPending)
      return setError("Wait for the proposal and agent records to finish loading.");
    if (!agentIdIsValid || !agent) return setError("Load a registered agent before reviewing.");
    if (!authorized)
      return setError("The connected wallet is not this agent’s owner or current operator.");
    if (participation?.participated)
      return setError("This agent has already used its one submission in this campaign.");
    if (!eligible) return setError("This proposal is not currently eligible for a new challenge.");
    if (!allegation || !explanation)
      return setError("Describe the alleged policy violation and supporting reasoning.");
    if (utf8Bytes(allegation) > VETO_LIMITS.allegationBytes)
      return setError("Allegation is too long for the contract.");
    if (utf8Bytes(explanation) > VETO_LIMITS.explanationBytes)
      return setError("Explanation is too long for the contract.");
    if (!validateEvidence(url))
      return setError(
        "Use exactly one HTTPS URL on a single lowercase *.netlify.app hostname, with no credentials, query, fragment, port, or spaces.",
      );
    setReview({ allegation, explanation, url });
    setConfirmed(false);
  };
  return (
    <div className="form-layout">
      <form className="veto-form" onSubmit={submit}>
        <div className="form-section">
          <h2 className="form-section-title">01 / Proposal & agent</h2>
          <Field label="Proposal">
            <input
              aria-label="Proposal"
              value={proposal ? `${proposal.title} · #${proposal.id}` : `Proposal #${proposalId}`}
              readOnly
            />
            <small>
              {proposal
                ? `${proposal.stage} · policy ${proposal.applicablePolicyIndex}`
                : "Live proposal data loads only from the configured VETO contract."}
            </small>
          </Field>
          <Field
            label="Registered agent"
            hint={
              discoveredAgent && !manualAgentSelection
                ? "Selected automatically from a finalized registration and verified against the live owner/operator record."
                : "Automatic recognition was unavailable or overridden. Use a verified on-chain agent ID as an advanced lookup."
            }
          >
            {discoveredAgent && !manualAgentSelection ? (
              <div className="detail-block">
                <p className="eyebrow">MY AGENT · VERIFIED ONCHAIN</p>
                <h3>{discoveredAgent.name}</h3>
                <p>
                  Agent #{discoveredAgent.id} · {discoveredAgent.active ? "active" : "inactive"}
                </p>
                <small>
                  {participation?.participated
                    ? "Already participated in this campaign."
                    : "No challenge recorded for this campaign yet."}
                </small>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setManualAgentSelection(true);
                      setAgentId("");
                    }}
                  >
                    Use another agent ID
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/agent/$id" params={{ id: discoveredAgent.id }}>
                      View Agent <ArrowUpRight />
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <input
                  aria-label="Registered agent ID"
                  name="agentId"
                  type="number"
                  min="1"
                  value={agentId}
                  onChange={(event) => {
                    setManualAgentSelection(true);
                    setAgentId(event.target.value);
                  }}
                  placeholder="Agent ID"
                  required
                />
                {wallet.address && walletAgentQuery.isPending && (
                  <small>
                    Finding a verified agent automatically… You can still use a known ID.
                  </small>
                )}
                {wallet.address && walletAgentQuery.data === null && (
                  <small>
                    No registration was found in this wallet’s history. Verify an ID once to use it.
                  </small>
                )}
              </>
            )}
            {agent && manualAgentSelection && (
              <small>
                {agent.name} · {agent.active ? "active" : "inactive"} ·{" "}
                {participation?.participated ? "already participated" : "not yet participated"}
              </small>
            )}
          </Field>
          {proposal && (
            <div className="detail-block">
              <h3>{campaign?.name ?? "Campaign"}</h3>
              {campaign && (
                <p className="text-xs text-muted-foreground mb-3">
                  Reward per accepted winner: {formatGen(campaign.rewardPerAcceptedAgent)} GEN ·
                  available reward pool: {formatGen(campaign.rewardAvailable)} GEN
                </p>
              )}
              <h3>Applicable policy</h3>
              <p>{proposal.applicablePolicy}</p>
              {proposal.policyLimitWei && proposal.policyLimitWei > 0n ? (
                <p className="text-xs text-muted-foreground mt-2">
                  Deterministic limit: {formatGen(proposal.policyLimitWei)} GEN. The contract
                  compares this immutable value with the actual escrow amount; submitted evidence
                  cannot override it.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2">
                  Semantic rule: a VALID model result is not reward-authorizing unless the evidence
                  hash is also authenticated by the configured authority.
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Recipient: {proposal.recipient} · escrow: {formatGen(proposal.paymentAmount)} GEN
              </p>
            </div>
          )}
        </div>
        <div className="form-section">
          <h2 className="form-section-title">02 / Your finding</h2>
          <Field label="Allegation">
            <input
              aria-label="Allegation"
              name="allegation"
              maxLength={VETO_LIMITS.allegationBytes}
              placeholder="Which policy does the proposal violate?"
              required
            />
          </Field>
          <Field
            label="Explanation"
            hint="Connect the allegation to the exact immutable policy and facts in the evidence."
          >
            <textarea
              aria-label="Explanation"
              name="explanation"
              maxLength={VETO_LIMITS.explanationBytes}
              required
              rows={5}
              placeholder="Explain the violation and why the evidence supports it."
            />
          </Field>
          <Field
            label="Netlify evidence URL"
            hint="Exactly one HTTPS *.netlify.app URL. The body must match VETO-EVIDENCE-V1, but JSON shape, hashes and validator agreement are not proof of external truth. Semantic rewards also require authority authentication."
          >
            <input
              aria-label="Netlify evidence URL"
              name="url"
              type="url"
              maxLength={VETO_LIMITS.evidenceUrlBytes}
              value={evidenceUrl}
              onChange={(event) => {
                setEvidenceUrl(event.target.value);
                setPreflight(undefined);
              }}
              placeholder="https://your-evidence.netlify.app"
              required
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={preflightBusy || !validateEvidence(evidenceUrl)}
              onClick={() => {
                if (!proposal) return;
                setPreflightBusy(true);
                void preflightEvidence(
                  evidenceUrl.trim(),
                  proposal.campaignId,
                  proposal.id,
                  proposal.applicablePolicyIndex,
                )
                  .then((message) => setPreflight({ tone: "success", message }))
                  .catch((reason: unknown) =>
                    setPreflight({
                      tone: "error",
                      message:
                        reason instanceof Error
                          ? reason.message
                          : "The browser could not preflight this evidence URL.",
                    }),
                  )
                  .finally(() => setPreflightBusy(false));
              }}
            >
              {preflightBusy ? "Checking response…" : "Check response format"}
            </Button>
            {preflight && (
              <small
                className={
                  preflight.tone === "success" ? "text-sm text-muted-foreground" : "form-error"
                }
              >
                {preflight.message}
                {preflight.tone === "error" &&
                  " Browser CORS or network policy can block this check without proving that GenLayer cannot retrieve the URL."}
              </small>
            )}
          </Field>
        </div>
        <WalletGate />
        {!manualAgentSelection && wallet.address && automaticAgentReadPending && (
          <ReadLoading message="Finding and verifying your registered agent…" />
        )}
        {!manualAgentSelection && wallet.address && walletAgentQuery.isError && (
          <>
            <ReadFailure
              title="Automatic agent recognition is unavailable."
              error={walletAgentQuery.error}
              onRetry={() => {
                void walletAgentQuery.refetch();
              }}
            />
            <p className="text-sm mt-3">
              <Link to="/agents" className="text-link">
                Find or register an agent <ArrowUpRight />
              </Link>
            </p>
          </>
        )}
        {!manualAgentSelection && wallet.address && walletAgentQuery.data === null && (
          <>
            <ReadNotFound
              title="No verified agent was found automatically."
              description="This deployment does not expose the direct wallet-to-agent view yet, and no verified registration was found for this wallet. Use the advanced Agent ID field above or register an agent."
            />
            <p className="text-sm mt-3">
              <Link to="/agents" className="text-link">
                Find or register an agent <ArrowUpRight />
              </Link>
            </p>
          </>
        )}
        {proposalReadPending && <ReadLoading message="Reading proposal eligibility…" />}
        {proposalQuery.isError && (
          <ReadFailure
            title="Proposal eligibility could not be read."
            error={proposalQuery.error}
            onRetry={() => {
              void proposalQuery.refetch();
            }}
          />
        )}
        {campaignReadPending && <ReadLoading message="Reading the campaign rules…" />}
        {proposal && campaignQuery.isError && (
          <ReadFailure
            title="Campaign eligibility could not be read."
            error={campaignQuery.error}
            onRetry={() => {
              void campaignQuery.refetch();
            }}
          />
        )}
        {agentIdIsValid && agentReadPending && <ReadLoading message="Reading registered agent…" />}
        {agentIdIsValid && agentQuery.isError && (
          <ReadFailure
            title="Agent eligibility could not be read."
            error={agentQuery.error}
            onRetry={() => {
              void agentQuery.refetch();
            }}
          />
        )}
        {agentIdIsValid && proposal?.campaignId && participationReadPending && (
          <ReadLoading message="Checking campaign participation…" />
        )}
        {agentIdIsValid && proposal?.campaignId && participationQuery.isError && (
          <ReadFailure
            title="Campaign participation could not be read."
            error={participationQuery.error}
            onRetry={() => {
              void participationQuery.refetch();
            }}
          />
        )}
        {agent && agentIdIsValid && !agent.active && (
          <div className="form-error" role="alert">
            <p>This agent is inactive and cannot submit a challenge.</p>
          </div>
        )}
        {agent && agentIdIsValid && wallet.status === "connected" && !authorized && (
          <div className="form-error" role="alert">
            <p>
              This wallet isn&apos;t authorized to submit challenges for the selected agent. Connect
              its owner or operator wallet.
            </p>
          </div>
        )}
        {participation?.participated && (
          <div className="form-error" role="alert">
            <p>
              This agent has already submitted a challenge in this competition. Each agent can
              participate only once per campaign.
            </p>
            {participation.challenge && (
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <p className="text-xs">
                  Existing challenge #{participation.challenge.id}: {participation.challenge.status}
                  .
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/finding/$id" params={{ id: participation.challenge.id }}>
                    Continue finding <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}
        {campaign && !campaign.intakeOpen && (
          <div className="form-error" role="alert">
            <p>
              This competition is no longer accepting new submissions. You can still review its
              proposals and results.
            </p>
          </div>
        )}
        {campaign && campaign.intakeOpen && campaign.remainingAgentSlots === 0 && (
          <div className="form-error" role="alert">
            <p>
              This competition has reached its participation cap and is no longer accepting new
              submissions.
            </p>
          </div>
        )}
        {proposal && ["CLEARED", "VETOED"].includes(proposal.stage) && (
          <div className="form-error" role="alert">
            <p>
              This proposal is already {proposal.stage.toLowerCase()}; new challenges are not
              available.
            </p>
          </div>
        )}
        {challengeId && challengeQuery.isPending && !recordedChallenge && (
          <ReadLoading message={`Reading challenge #${challengeId} from Studio Next…`} />
        )}
        {challengeId && challengeQuery.isError && (
          <ReadFailure
            title="The recorded challenge could not be read."
            error={challengeQuery.error}
            onRetry={() => {
              void challengeQuery.refetch();
            }}
          />
        )}
        {Boolean(error) && <VetoErrorNotice error={error} />}
        <Button type="submit">
          Review evidence <ArrowRight />
        </Button>
        {review && (
          <section className="review" aria-live="polite">
            <p className="eyebrow">CHALLENGE REVIEW · NOT SUBMITTED</p>
            <h3 className="mt-4">{review.allegation}</h3>
            <p className="text-sm text-muted-foreground mb-6">{review.explanation}</p>
            <div className="review-warning">
              <strong>One campaign participation slot will be consumed.</strong>
              <p className="break-all">{review.url}</p>
              <p>
                Your submission is evaluated against the campaign policy. The publisher’s
                self-declared violation flag is not proof by itself. Submitting evidence does not
                guarantee a reward; semantic evidence without an on-chain authority attestation is
                rejected for reward purposes.
              </p>
            </div>
            <label className="review-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I have reviewed the proposal, allegation, explanation, and single evidence URL.
            </label>
            <Button
              type="button"
              disabled={!confirmed || !eligible || !canWrite(wallet)}
              onClick={() =>
                setWrite(
                  submitChallengeWrite(
                    proposalId,
                    agentId,
                    review.allegation,
                    review.explanation,
                    review.url,
                  ),
                )
              }
            >
              {eligibilityReadPending
                ? "Reading eligibility…"
                : eligibilityReadError
                  ? "Eligibility unavailable"
                  : canWrite(wallet) && eligible
                    ? "Submit challenge"
                    : "Challenge unavailable"}
            </Button>
            {txId && (
              <p className="text-xs text-muted-foreground mt-4">Submission finalized: {txId}</p>
            )}
            {recordedChallenge && (
              <div className="detail-block mt-5" aria-live="polite">
                <p className="eyebrow">CHALLENGE RECORD #{recordedChallenge.id}</p>
                <h3>{recordedChallenge.status}</h3>
                <p>
                  {recordedChallenge.accepted
                    ? "The contract established this challenge as the winning finding."
                    : recordedChallenge.status === "VALID"
                      ? "GenLayer marked the finding VALID. The ordered proposal resolution still determines whether it wins."
                      : "The contract has recorded the submission; review its evaluation and ordered resolution state below."}
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild variant="outline">
                    <Link to="/finding/$id" params={{ id: recordedChallenge.id }}>
                      Open finding <ArrowUpRight />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/proposal/$id" params={{ id: proposalId }}>
                      Review proposal <ArrowUpRight />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/agent/$id" params={{ id: agentId }}>
                      View Agent <ArrowUpRight />
                    </Link>
                  </Button>
                  {recordedChallenge.accepted && recordedChallenge.rewardReserved && (
                    <span className="text-sm text-muted-foreground self-center">
                      Winning reward reserved on-chain.
                    </span>
                  )}
                </div>
              </div>
            )}
            {recordedChallenge && challengeEvaluationAvailable(recordedChallenge) && (
              <ContractAction
                write={simpleWrite("evaluate_challenge", recordedChallenge.id)}
                label={
                  recordedChallenge.status === "INCONCLUSIVE"
                    ? "Retry evaluation"
                    : "Evaluate challenge now"
                }
              />
            )}
            <WriteRunner
              write={write}
              label="Submit challenge"
              onDone={async (id) => {
                setTxId(id);
                setWrite(null);
                try {
                  if (proposal) {
                    const participation = await getAgentCampaignParticipation(
                      agentId,
                      proposal.campaignId,
                    );
                    const recordedId = participation.challengeId;
                    setChallengeId(recordedId ?? "");
                    if (recordedId) {
                      await invalidateVetoQueries(
                        queryClient,
                        invalidationKeysForWrite(write, queryClient, {
                          address: wallet.address,
                          chainId: wallet.chainId,
                        }),
                      );
                      await navigate({ to: "/finding/$id", params: { id: recordedId } });
                      return;
                    }
                    setError(
                      "The submission finalized, but its challenge ID was not returned by the contract. Open the proposal and refresh its findings.",
                    );
                  }
                } catch (reason) {
                  setError(reason);
                }
                void invalidateVetoQueries(
                  queryClient,
                  invalidationKeysForWrite(write, queryClient, {
                    address: wallet.address,
                    chainId: wallet.chainId,
                  }),
                );
              }}
              onError={(reason) => {
                setError(reason);
                setWrite(null);
              }}
              onDismiss={() => setWrite(null)}
            />
          </section>
        )}
      </form>
      <aside className="form-aside">
        <ShieldCheck size={25} strokeWidth={1} />
        <h3>First valid. Not first evaluated.</h3>
        <p>
          Evaluation is immediately eligible after the challenge is recorded, but a later VALID
          result cannot bypass an earlier eligible submission.
        </p>
        <div className="aside-divider" />
        <p>
          Each agent gets one submission per campaign. A rejected or expired challenge consumes its
          slot and does not earn GEN.
        </p>
      </aside>
    </div>
  );
}

export function FundedProposalForm() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [campaignPage, setCampaignPage] = useState(0);
  const campaignsQuery = useMyCampaigns(
    campaignPage * 50,
    50,
    wallet.address,
    wallet.connectedClient,
  );
  const campaigns = campaignsQuery.data?.items ?? [];
  const creatorReadReady =
    connectionState === "ready" &&
    wallet.status === "connected" &&
    Boolean(wallet.address && wallet.connectedClient);
  const pendingTransactions = usePendingTransactions(pendingScope(wallet.address, wallet.chainId));
  const campaignCreationPending = pendingTransactions.some(
    (record) => record.method === "create_campaign",
  );
  const [campaignId, setCampaignId] = useState("");
  const selectedCampaignQuery = useCampaign(campaignId);
  const campaign = selectedCampaignQuery.data ?? campaigns.find((item) => item.id === campaignId);
  const [error, setError] = useState<unknown>();
  const [review, setReview] = useState<{
    title: string;
    description: string;
    recipient: string;
    amount: bigint;
    policyIndex: number;
  }>();
  const [confirmed, setConfirmed] = useState(false);
  const [write, setWrite] = useState<ContractWrite | null>(null);
  const [txId, setTxId] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const title = String(form.get("title") ?? "").trim();
      const description = String(form.get("description") ?? "").trim();
      const recipient = String(form.get("recipient") ?? "").trim();
      const amount = positiveGen(String(form.get("amount") ?? ""));
      const policyIndex = Number(form.get("policyIndex"));
      if (
        !campaign ||
        !wallet.address ||
        campaign.creator.toLowerCase() !== wallet.address.toLowerCase()
      )
        throw new Error("Select a campaign owned by the connected wallet.");
      if (!campaign.intakeOpen) throw new Error("This campaign is no longer accepting proposals.");
      if (!title || !description) throw new Error("Enter a proposal title and description.");
      if (utf8Bytes(title) > VETO_LIMITS.titleBytes)
        throw new Error("Proposal title is too long for the contract.");
      if (utf8Bytes(description) > VETO_LIMITS.descriptionBytes)
        throw new Error("Proposal description is too long for the contract.");
      if (!isAddress(recipient)) throw new Error("Enter a valid recipient 0x address.");
      if (!Number.isInteger(policyIndex) || policyIndex < 1 || policyIndex > campaign.policyCount)
        throw new Error("Choose an applicable campaign policy.");
      setReview({ title, description, recipient, amount, policyIndex });
      setConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Check your proposal.");
    }
  };
  return (
    <form className="veto-form max-w-2xl mt-8" onSubmit={submit}>
      <h2 className="form-section-title">Create a funded proposal</h2>
      <Field label="Owned campaign">
        <select
          aria-label="Owned campaign"
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          disabled={
            !creatorReadReady ||
            campaignsQuery.isPending ||
            campaignsQuery.isError ||
            campaigns.length === 0
          }
          required
        >
          <option value="">Select an onchain campaign</option>
          {campaigns.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · #{item.id} · {campaignLabel(item)}
            </option>
          ))}
        </select>
      </Field>
      {!creatorReadReady && (
        <ReadNotFound
          title={
            connectionState !== "ready"
              ? "Campaign reads are not configured."
              : "Connect the creator wallet."
          }
          description={
            connectionState !== "ready"
              ? "A verified VETO deployment is required before owned campaigns can be read."
              : "The owned-campaign selector is populated only after the wallet that created a campaign is connected on Studio Next."
          }
        />
      )}
      {creatorReadReady && campaignCreationPending && campaigns.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          Campaign creation is awaiting GenLayer finality. The owned campaign list will refresh when
          the transaction is finalized.
        </p>
      )}
      {creatorReadReady &&
        campaignsQuery.isPending &&
        !campaignsQuery.data &&
        !campaignCreationPending && <ReadLoading message="Loading owned campaigns from VETO…" />}
      {creatorReadReady && campaignsQuery.isError && (
        <ReadFailure
          title="Owned campaigns could not be read."
          error={campaignsQuery.error}
          onRetry={() => {
            void campaignsQuery.refetch();
          }}
        />
      )}
      {creatorReadReady &&
        !campaignCreationPending &&
        campaignsQuery.data &&
        !campaignsQuery.isError &&
        campaigns.length === 0 && (
          <ReadNotFound
            title="No campaigns owned by this wallet."
            description="The read completed successfully, but the connected wallet is not the creator of any returned campaign."
          />
        )}
      {campaignId && selectedCampaignQuery.isPending && (
        <ReadLoading message="Loading the selected campaign policy…" />
      )}
      {campaignId && selectedCampaignQuery.isError && (
        <ReadFailure
          title="The selected campaign policy could not be read."
          error={selectedCampaignQuery.error}
          onRetry={() => void selectedCampaignQuery.refetch()}
        />
      )}
      <PageControls
        page={campaignPage}
        total={campaignsQuery.data?.total ?? 0}
        limit={50}
        onChange={setCampaignPage}
      />
      <Field label="Proposal title">
        <input
          aria-label="Proposal title"
          name="title"
          maxLength={VETO_LIMITS.titleBytes}
          required
          placeholder="What payment is being proposed?"
        />
      </Field>
      <Field label="Proposal description">
        <textarea
          aria-label="Proposal description"
          name="description"
          maxLength={VETO_LIMITS.descriptionBytes}
          required
          placeholder="Describe the purpose and context."
        />
      </Field>
      <Field label="Recipient address">
        <input aria-label="Recipient address" name="recipient" required placeholder="0x…" />
      </Field>
      <Amount
        name="amount"
        label="Proposal escrow"
        hint="Separately funded GEN. This is never part of the campaign reward pool."
      />
      <Field label="Applicable policy">
        <select aria-label="Applicable policy" name="policyIndex" required disabled={!campaign}>
          <option value="">Select policy</option>
          {campaign?.policies.map((policy, index) => (
            <option key={index} value={index + 1}>
              {index + 1}. {policy}
            </option>
          ))}
        </select>
      </Field>
      {campaign && review && (
        <p className="text-xs text-muted-foreground">
          {(() => {
            const text = campaign.policies[review.policyIndex - 1] ?? "";
            return text.startsWith("MAX_PAYMENT_WEI:")
              ? "This proposal will be checked deterministically against the typed payment limit."
              : "This semantic policy requires independently authenticated evidence before a finding can earn GEN.";
          })()}
        </p>
      )}
      <WalletGate />
      {Boolean(error) && <VetoErrorNotice error={error} />}
      <Button type="submit">
        Review proposal <ArrowRight />
      </Button>
      {review && campaign && (
        <section className="review">
          <p className="eyebrow">PROPOSAL REVIEW · NOT SUBMITTED</p>
          <h3 className="mt-4">{review.title}</h3>
          <dl>
            <dt>Campaign</dt>
            <dd>
              {campaign.name} · #{campaign.id}
            </dd>
            <dt>Recipient</dt>
            <dd>{review.recipient}</dd>
            <dt>Separate escrow</dt>
            <dd>{formatGen(review.amount)} GEN</dd>
            <dt>Applicable policy</dt>
            <dd>{review.policyIndex}</dd>
          </dl>
          <div className="review-warning">
            <strong>Proposal escrow is separate.</strong>
            <p>
              The campaign creator funds this payment with a separate native GEN value. It can be
              paid only after CLEARED, or refunded to the original funder after VETOED.
            </p>
          </div>
          <label className="review-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I have reviewed the recipient, escrow, and applicable policy.
          </label>
          <Button
            type="button"
            disabled={!confirmed || !canWrite(wallet)}
            onClick={() =>
              setWrite(
                addProposalWrite(
                  campaign.id,
                  review.title,
                  review.description,
                  review.recipient,
                  review.amount,
                  review.policyIndex,
                ),
              )
            }
          >
            {canWrite(wallet) ? "Fund proposal" : "Connect contract and wallet"}
          </Button>
          {txId && (
            <p className="text-xs text-muted-foreground mt-4">
              Proposal transaction finalized: {txId}
            </p>
          )}
          <WriteRunner
            write={write}
            label="Fund proposal"
            onDone={async (id) => {
              setTxId(id);
              setWrite(null);
              const client = wallet.connectedClient;
              if (!client) {
                setError(
                  "Proposal funding finalized, but the wallet client disconnected before the new proposal could be verified.",
                );
                return;
              }
              try {
                const receipt = await getVetoTransaction(client, id);
                const proposalId = transactionResultId(receipt);
                if (!proposalId) {
                  setError(
                    "Proposal funding finalized, but Studio Next did not return a verifiable proposal ID. Open the campaign to continue.",
                  );
                  return;
                }
                const proposal = await getProposal(proposalId, client);
                if (proposal.id !== proposalId) {
                  setError(
                    "Proposal funding finalized, but the returned proposal ID could not be verified on-chain.",
                  );
                  return;
                }
                await invalidateVetoQueries(
                  queryClient,
                  invalidationKeysForWrite(write, queryClient, {
                    address: wallet.address,
                    chainId: wallet.chainId,
                  }),
                );
                await navigate({ to: "/proposal/$id", params: { id: proposalId } });
              } catch (reason) {
                setError(reason);
              }
            }}
            onError={(reason) => {
              setError(reason);
              setWrite(null);
            }}
            onDismiss={() => setWrite(null)}
          />
        </section>
      )}
    </form>
  );
}
