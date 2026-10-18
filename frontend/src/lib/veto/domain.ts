export const GEN_DECIMALS = 18;
export const GEN_WEI = 10n ** 18n;
export const TYPED_POLICY_PREFIX = "MAX_PAYMENT_WEI:";
export const VETO_LIMITS = {
  nameBytes: 120,
  descriptionBytes: 4000,
  policyBytes: 800,
  policiesBytes: 6000,
  titleBytes: 200,
  allegationBytes: 1000,
  explanationBytes: 3000,
  evidenceUrlBytes: 500,
  challengesPerProposal: 32,
} as const;
export const STUDIO_NEXT_CHAIN_ID = 61997;
export const STUDIO_NEXT_CHAIN_HEX = `0x${STUDIO_NEXT_CHAIN_ID.toString(16)}`;
const configuredRpcUrl = import.meta.env["VITE_GENLAYER_RPC_URL"] as string | undefined;
const configuredChainId = import.meta.env["VITE_GENLAYER_CHAIN_ID"] as string | undefined;
const parsedChainId = configuredChainId ? Number(configuredChainId) : STUDIO_NEXT_CHAIN_ID;
export const STUDIO_NEXT_RPC_URL = configuredRpcUrl ?? "https://studio-next.genlayer.com/api";
export const STUDIO_NEXT_EXPLORER_URL = "https://explorer-studio-dev.genlayer.com";

const configuredAddress = import.meta.env["VITE_VETO_CONTRACT_ADDRESS"] as string | undefined;
export const VETO_CONTRACT_ADDRESS =
  configuredAddress && /^0x[0-9a-fA-F]{40}$/.test(configuredAddress)
    ? configuredAddress
    : undefined;

const configurationErrors = [
  Number.isInteger(parsedChainId) && parsedChainId === STUDIO_NEXT_CHAIN_ID
    ? undefined
    : `VITE_GENLAYER_CHAIN_ID must be ${STUDIO_NEXT_CHAIN_ID}.`,
  /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(STUDIO_NEXT_RPC_URL)
    ? undefined
    : "VITE_GENLAYER_RPC_URL must be a valid HTTPS URL.",
  VETO_CONTRACT_ADDRESS ? undefined : "VITE_VETO_CONTRACT_ADDRESS is missing or invalid.",
].filter((value): value is string => Boolean(value));

export const VETO_CONFIGURATION_ERROR = configurationErrors.join(" ");

export const chainConfig = {
  chainId: STUDIO_NEXT_CHAIN_ID,
  chainHex: STUDIO_NEXT_CHAIN_HEX,
  name: "GenLayer Studio Next",
  symbol: "GEN",
  decimals: GEN_DECIMALS,
  explorer: STUDIO_NEXT_EXPLORER_URL,
  rpc: STUDIO_NEXT_RPC_URL,
  contract: VETO_CONTRACT_ADDRESS,
} as const;

export type ConnectionState = "unconfigured" | "ready";
export const connectionState: ConnectionState = VETO_CONFIGURATION_ERROR ? "unconfigured" : "ready";
export const integrationMessage =
  connectionState === "ready"
    ? "Reads and transactions use the verified VETO V1 interface on GenLayer Studio Next."
    : `${VETO_CONFIGURATION_ERROR} No campaigns, balances, or transactions are fabricated while configuration is invalid.`;

export type CampaignStatus = "ACTIVE" | "CLOSED";
export type CampaignLabel = "OPEN" | "CAP REACHED" | "DEADLINE EXPIRED" | "CLOSED";
export type ProposalStage = "OPEN" | "PENDING" | "CLEARED" | "VETOED";
export type ChallengeStatus =
  "PENDING" | "VALID" | "INVALID" | "INCONCLUSIVE" | "EXPIRED" | "SUPERSEDED";
export type EscrowState = "LOCKED" | "PAID" | "REFUNDABLE" | "REFUNDED";

export interface Campaign {
  id: string;
  creator: string;
  name: string;
  description: string;
  policyCount: number;
  policies: string[];
  maxAgents: number;
  participatingAgents: number;
  remainingAgentSlots: number;
  acceptedAgents: number;
  rewardPerAcceptedAgent: bigint;
  durationSeconds: number;
  createdAt: number;
  deadline: number;
  closedAt: number;
  status: CampaignStatus;
  intakeOpen: boolean;
  canClose: boolean;
  proposalCount: number;
  openProposalCount: number;
  challengeCount: number;
  rewardFunded: bigint;
  rewardReserved: bigint;
  rewardClaimable: bigint;
  rewardPaid: bigint;
  rewardRefunded: bigint;
  rewardAvailable: bigint;
  remainderClaimed: boolean;
}

export interface Proposal {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  recipient: string;
  funder: string;
  paymentAmount: bigint;
  applicablePolicyIndex: number;
  applicablePolicy: string;
  policyLimitWei?: bigint;
  createdAt: number;
  stage: ProposalStage;
  challengeCount: number;
  resolutionCursor: number;
  winnerChallengeId: string | null;
  escrowState: EscrowState;
  terminalAt: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  owner: string;
  operator: string;
  payoutAddress: string;
  active: boolean;
  challengeCount: number;
  acceptedCount: number;
  claimable: bigint;
  totalEarned: bigint;
}

export interface Challenge {
  id: string;
  proposalId: string;
  campaignId: string;
  agentId: string;
  allegation: string;
  explanation: string;
  evidenceUrl: string;
  submittedAt: number;
  evaluationDeadline: number;
  attempts: number;
  status: ChallengeStatus;
  policyMatch: boolean;
  evidenceSufficient: boolean;
  policyIndex: number;
  evidenceStatus: string;
  evidenceSha256: string;
  evaluatedAt: number;
  accepted: boolean;
  rewardReserved: boolean;
}

export interface Participation {
  participated: boolean;
  challengeId: string | null;
  challenge?: Challenge;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ContractConfig {
  protocol: string;
  minDuration: number;
  maxDuration: number;
  maxAgents: number;
  evaluationGrace: number;
  evidenceAuthority?: string;
  typedPolicyPrefix?: string;
}

export interface GlobalAccounting {
  rewardFunded: bigint;
  rewardReserved: bigint;
  rewardClaimable: bigint;
  rewardPaid: bigint;
  rewardRefunded: bigint;
  rewardAvailable: bigint;
  escrowFunded: bigint;
  escrowLocked: bigint;
  escrowPaid: bigint;
  escrowRefunded: bigint;
  accountedContractBalance: bigint;
}

export type ResolutionStep =
  | { kind: "challenge"; challenge: Challenge; index: number }
  | { kind: "clear" }
  | { kind: "blocked"; challenge: Challenge; index: number }
  | null;

export function challengeEvaluationAvailable(
  challenge: Pick<Challenge, "status" | "attempts" | "evaluationDeadline">,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return (
    (challenge.status === "PENDING" || challenge.status === "INCONCLUSIVE") &&
    challenge.attempts < 2 &&
    now <= challenge.evaluationDeadline
  );
}

export function resolutionStep(
  proposal: Pick<Proposal, "stage" | "challengeCount" | "resolutionCursor">,
  challenges: Challenge[],
  intakeOpen: boolean,
  now = Math.floor(Date.now() / 1000),
): ResolutionStep {
  if (proposal.stage === "CLEARED" || proposal.stage === "VETOED") return null;
  if (proposal.resolutionCursor >= proposal.challengeCount) {
    return intakeOpen ? null : { kind: "clear" };
  }
  const target = challenges[proposal.resolutionCursor];
  if (!target) return null;
  const resolvable =
    target.status === "VALID" ||
    target.status === "INVALID" ||
    target.status === "EXPIRED" ||
    (target.status === "INCONCLUSIVE" &&
      (target.attempts >= 2 || now > target.evaluationDeadline)) ||
    (target.status === "PENDING" && now > target.evaluationDeadline);
  return resolvable
    ? { kind: "challenge", challenge: target, index: proposal.resolutionCursor }
    : { kind: "blocked", challenge: target, index: proposal.resolutionCursor };
}

export function parseGen(value: string): bigint {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(normalized))
    throw new Error("Enter a GEN amount with up to 18 decimal places.");
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * GEN_WEI + BigInt(fraction.padEnd(GEN_DECIMALS, "0") || "0");
}

export function positiveGen(value: string): bigint {
  const amount = parseGen(value);
  if (amount <= 0n) throw new Error("GEN amount must be greater than zero.");
  return amount;
}

export function formatGen(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / GEN_WEI;
  const fraction = (absolute % GEN_WEI).toString().padStart(GEN_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function requiredCampaignFunding(maxAgents: number, reward: bigint): bigint {
  if (!Number.isSafeInteger(maxAgents) || maxAgents <= 0)
    throw new Error("Maximum agents must be positive.");
  return BigInt(maxAgents) * reward;
}

export function validateCampaignDuration(seconds: number, config?: ContractConfig): void {
  const minimum = config?.minDuration ?? 60 * 60;
  const maximum = config?.maxDuration ?? 30 * 24 * 60 * 60;
  if (!Number.isInteger(seconds) || seconds < minimum || seconds > maximum)
    throw new Error(
      `Campaign duration must be between ${formatDuration(minimum)} and ${formatDuration(maximum)}.`,
    );
}

export function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  return `${seconds.toLocaleString()} seconds`;
}

export function campaignLabel(
  campaign: Pick<Campaign, "status" | "intakeOpen" | "remainingAgentSlots">,
): CampaignLabel {
  if (campaign.status === "CLOSED") return "CLOSED";
  if (campaign.remainingAgentSlots === 0) return "CAP REACHED";
  if (!campaign.intakeOpen) return "DEADLINE EXPIRED";
  return "OPEN";
}

export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function agentControlsWallet(
  agent: Pick<Agent, "owner" | "operator">,
  address?: string,
): boolean {
  if (!address) return false;
  const wallet = address.toLowerCase();
  return agent.owner.toLowerCase() === wallet || agent.operator.toLowerCase() === wallet;
}

export function isContractId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

/** Normalize a router or decoded transaction ID before it reaches a contract read. */
export function normalizeContractId(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return undefined;
    return String(value);
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return isContractId(normalized) ? normalized : undefined;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateEvidence(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = value.slice("https://".length).split("/", 1)[0] ?? "";
    const suffix = ".netlify.app";
    const label = url.hostname.slice(0, -suffix.length);
    const hasControlCharacter = Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
    return (
      new TextEncoder().encode(value).length <= 500 &&
      !hasControlCharacter &&
      !/\s/.test(value) &&
      url.protocol === "https:" &&
      authority === authority.toLowerCase() &&
      authority === url.hostname &&
      !authority.includes(":") &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      !value.includes("\\") &&
      url.hostname.endsWith(suffix) &&
      label.length > 0 &&
      !label.includes(".") &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
  } catch {
    return false;
  }
}

export async function preflightEvidence(
  value: string,
  campaignId: string,
  proposalId: string,
  policyIndex: number,
): Promise<string> {
  if (!validateEvidence(value))
    throw new Error("Enter one valid HTTPS Netlify evidence URL first.");
  const response = await fetch(value, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`The evidence endpoint returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4096)
    throw new Error("The evidence response is larger than the contract’s 4,096-byte limit.");
  const body = await response.text();
  if (utf8Bytes(body) > 4096)
    throw new Error("The evidence response is larger than the contract’s 4,096-byte limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("The evidence response is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("The evidence response must be a JSON object.");
  const record = parsed as Record<string, unknown>;
  if (record["schema"] !== "VETO-EVIDENCE-V1")
    throw new Error("The evidence schema must be VETO-EVIDENCE-V1.");
  if (
    record["campaign_id"] !== Number(campaignId) ||
    record["proposal_id"] !== Number(proposalId) ||
    record["policy_index"] !== policyIndex
  )
    throw new Error("The evidence IDs or 1-based policy index do not match this proposal.");
  if (typeof record["violation"] !== "boolean")
    throw new Error("The evidence violation field must be a boolean.");
  for (const field of ["facts", "statement"]) {
    if (typeof record[field] !== "string" || !record[field].trim())
      throw new Error(`The evidence ${field} field must be non-empty text.`);
    if (utf8Bytes(record[field]) > 2000)
      throw new Error(`The evidence ${field} field exceeds the 2,000-byte limit.`);
  }
  return "The browser could read a VETO-EVIDENCE-V1-shaped response with matching context. GenLayer still decides whether the facts prove a violation.";
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
