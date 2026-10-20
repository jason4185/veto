import type { Address } from "viem";
import { isAddress } from "viem";
import { getReadClient, type GenLayerClient } from "./client";
import { vetoContractAddress } from "./network";
import {
  STUDIO_NEXT_CHAIN_ID,
  STUDIO_NEXT_RPC_URL,
  agentControlsWallet,
  normalizeContractId,
} from "./domain";
import { VetoReadError, type VetoReadState } from "./errors";
import type {
  Agent,
  Campaign,
  Challenge,
  ContractConfig,
  GlobalAccounting,
  Page,
  Participation,
  Proposal,
} from "./domain";
import { runRpcRequest } from "./rpc";

// GenLayer returns decoded contract records without generated TypeScript ABI types.
// Every field is validated at this boundary before it enters the UI model.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const READ_TIMEOUT_MS = 20_000;
export const VETO_READ_STATE: VetoReadState = "latest-nonfinal";

export type ContractWrite = {
  kind: "write";
  address: Address;
  method: string;
  args: unknown[];
  value?: bigint;
};

function record(value: unknown, field: string): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Contract returned an invalid ${field}.`);
  return value;
}
function integer(value: unknown, field: string): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  } catch {
    /* stable error below */
  }
  throw new Error(`Contract returned an invalid ${field}.`);
}
function numberValue(value: unknown, field: string) {
  const parsed = integer(value, field);
  const result = Number(parsed);
  if (!Number.isSafeInteger(result)) throw new Error(`Contract returned an unsafe ${field}.`);
  return result;
}
function stringValue(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Contract returned an invalid ${field}.`);
  return value;
}
function booleanValue(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new Error(`Contract returned an invalid ${field}.`);
  return value;
}
function oneOf<const T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const parsed = stringValue(value, field);
  if (!allowed.includes(parsed as T)) throw new Error(`Contract returned an invalid ${field}.`);
  return parsed as T;
}
function contractId(value: string, field: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`Invalid ${field}.`);
  return BigInt(value);
}
function pageNumber(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${field}.`);
  return BigInt(value);
}
function pageLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${field}.`);
  return Math.min(value, 50);
}
async function read(client: GenLayerClient, method: string, args: unknown[] = []) {
  const state = VETO_READ_STATE;
  const startedAt = performance.now();
  const sender = client.account?.address;
  const context = {
    contract: vetoContractAddress,
    chainId: STUDIO_NEXT_CHAIN_ID,
    rpcUrl: STUDIO_NEXT_RPC_URL,
    method,
    args: args.map((value) => (typeof value === "bigint" ? value.toString() : String(value))),
    state,
    durationMs: 0,
    ...(sender ? { sender } : {}),
  } satisfies Omit<ConstructorParameters<typeof VetoReadError>[0], "durationMs"> & {
    durationMs: number;
  };
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const key = JSON.stringify([
      "contract-read",
      vetoContractAddress.toLowerCase(),
      STUDIO_NEXT_CHAIN_ID,
      state,
      sender?.toLowerCase() ?? "public",
      method,
      args.map((value) => (typeof value === "bigint" ? value.toString() : String(value))),
    ]);
    const result = await runRpcRequest({
      key,
      method,
      context: {
        source: "contract.read",
        queryKey: method,
        trigger: "query",
        necessary: true,
      },
      request: async () => {
        const request = client.readContract({
          address: vetoContractAddress,
          functionName: method,
          args: args as never[],
          transactionHashVariant: state as never,
        });
        return Promise.race([
          request,
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`Studio Next read timed out after ${READ_TIMEOUT_MS} ms.`)),
              READ_TIMEOUT_MS,
            );
          }),
        ]);
      },
    });
    if (import.meta.env.DEV)
      console.debug("[veto:read]", {
        ...context,
        durationMs: Math.round(performance.now() - startedAt),
        result: "ok",
      });
    return result;
  } catch (reason) {
    const error = new VetoReadError(
      { ...context, durationMs: Math.round(performance.now() - startedAt) },
      reason,
    );
    if (import.meta.env.DEV)
      console.debug("[veto:read]", { ...error.context, result: "error", error: error.causeText });
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function page<T>(value: unknown, field: string, map: (value: unknown) => T): Page<T> {
  const item = record(value, `${field} page`);
  if (!Array.isArray(item.items)) throw new Error(`Contract returned an invalid ${field} page.`);
  return {
    items: item.items.map(map),
    total: numberValue(item.total, `${field} total`),
    offset: numberValue(item.offset, `${field} offset`),
    limit: numberValue(item.limit, `${field} limit`),
    hasMore: booleanValue(item.has_more, `${field} pagination`),
  };
}

function mapAgent(value: unknown): Agent {
  const item = record(value, "agent");
  return {
    id: String(numberValue(item.agent_id, "agent id")),
    name: stringValue(item.name, "agent name"),
    description: stringValue(item.description, "agent description"),
    owner: stringValue(item.owner, "agent owner"),
    operator: stringValue(item.operator, "agent operator"),
    payoutAddress: stringValue(item.payout_address, "agent payout address"),
    active: booleanValue(item.active, "agent active status"),
    challengeCount: numberValue(item.challenge_count, "agent challenge count"),
    acceptedCount: numberValue(item.accepted_count, "agent accepted count"),
    claimable: integer(item.claimable, "agent claimable"),
    totalEarned: integer(item.total_earned, "agent total earned"),
  };
}
function mapCampaign(value: unknown): Campaign {
  const item = record(value, "campaign");
  return {
    id: String(numberValue(item.campaign_id, "campaign id")),
    creator: stringValue(item.creator, "campaign creator"),
    name: stringValue(item.name, "campaign name"),
    description: stringValue(item.description, "campaign description"),
    policyCount: numberValue(item.policy_count, "policy count"),
    policies: [],
    maxAgents: numberValue(item.max_agents, "maximum agents"),
    participatingAgents: numberValue(item.participating_agents, "participating agents"),
    remainingAgentSlots: numberValue(item.remaining_agent_slots, "remaining slots"),
    acceptedAgents: numberValue(item.accepted_agents, "accepted agents"),
    rewardPerAcceptedAgent: integer(item.reward_per_accepted_agent, "reward"),
    durationSeconds: numberValue(item.duration_seconds, "campaign duration"),
    createdAt: numberValue(item.created_at, "campaign creation time"),
    deadline: numberValue(item.deadline, "campaign deadline"),
    closedAt: numberValue(item.closed_at, "campaign close time"),
    status: oneOf(item.status, ["ACTIVE", "CLOSED"] as const, "campaign status"),
    intakeOpen: booleanValue(item.intake_open, "campaign intake status"),
    canClose: booleanValue(item.can_close, "campaign closure status"),
    proposalCount: numberValue(item.proposal_count, "proposal count"),
    openProposalCount: numberValue(item.open_proposal_count, "open proposal count"),
    challengeCount: numberValue(item.challenge_count, "challenge count"),
    rewardFunded: integer(item.reward_funded, "funded reward"),
    rewardReserved: integer(item.reward_reserved, "reserved reward"),
    rewardClaimable: integer(item.reward_claimable, "claimable reward"),
    rewardPaid: integer(item.reward_paid, "paid reward"),
    rewardRefunded: integer(item.reward_refunded, "refunded reward"),
    rewardAvailable: integer(item.reward_available, "available reward"),
    remainderClaimed: booleanValue(item.remainder_claimed, "remainder claim status"),
  };
}
function mapProposal(value: unknown): Proposal {
  const item = record(value, "proposal");
  const winner = numberValue(item.winner_challenge_id, "winner challenge id");
  return {
    id: String(numberValue(item.proposal_id, "proposal id")),
    campaignId: String(numberValue(item.campaign_id, "proposal campaign id")),
    title: stringValue(item.title, "proposal title"),
    description: stringValue(item.description, "proposal description"),
    recipient: stringValue(item.recipient, "proposal recipient"),
    funder: stringValue(item.funder, "proposal funder"),
    paymentAmount: integer(item.payment_amount, "proposal payment"),
    applicablePolicyIndex: numberValue(item.applicable_policy_index, "policy index"),
    applicablePolicy: stringValue(item.applicable_policy, "applicable policy"),
    policyLimitWei: integer(item.policy_limit_wei ?? 0, "policy limit"),
    createdAt: numberValue(item.created_at, "proposal creation time"),
    stage: oneOf(item.status, ["OPEN", "PENDING", "CLEARED", "VETOED"] as const, "proposal status"),
    challengeCount: numberValue(item.challenge_count, "proposal challenge count"),
    resolutionCursor: numberValue(item.resolution_cursor, "resolution cursor"),
    winnerChallengeId: winner === 0 ? null : String(winner),
    escrowState: oneOf(
      item.escrow_state,
      ["LOCKED", "PAID", "REFUNDABLE", "REFUNDED"] as const,
      "escrow state",
    ),
    terminalAt: numberValue(item.terminal_at, "proposal terminal time"),
  };
}
function mapChallenge(value: unknown): Challenge {
  const item = record(value, "challenge");
  return {
    id: String(numberValue(item.challenge_id, "challenge id")),
    proposalId: String(numberValue(item.proposal_id, "challenge proposal id")),
    campaignId: String(numberValue(item.campaign_id, "challenge campaign id")),
    agentId: String(numberValue(item.agent_id, "challenge agent id")),
    allegation: stringValue(item.allegation, "allegation"),
    explanation: stringValue(item.explanation, "explanation"),
    evidenceUrl: stringValue(item.evidence_url, "evidence URL"),
    submittedAt: numberValue(item.submitted_at, "challenge submission time"),
    evaluationDeadline: numberValue(item.evaluation_deadline, "evaluation deadline"),
    attempts: numberValue(item.attempts, "evaluation attempts"),
    status: oneOf(
      item.status,
      ["PENDING", "VALID", "INVALID", "INCONCLUSIVE", "EXPIRED", "SUPERSEDED"] as const,
      "challenge status",
    ),
    policyMatch: booleanValue(item.policy_match, "policy match"),
    evidenceSufficient: booleanValue(item.evidence_sufficient, "evidence sufficiency"),
    policyIndex: numberValue(item.policy_index, "challenge policy index"),
    evidenceStatus: stringValue(item.evidence_status, "evidence status"),
    evidenceSha256: stringValue(item.evidence_sha256, "evidence hash"),
    evaluatedAt: numberValue(item.evaluated_at, "evaluation time"),
    accepted: booleanValue(item.accepted, "challenge acceptance"),
    rewardReserved: booleanValue(item.reward_reserved, "challenge reward reservation"),
  };
}

export async function getConfig(client = getReadClient()): Promise<ContractConfig> {
  const item = record(await read(client, "get_config"), "configuration");
  return {
    protocol: stringValue(item.protocol, "protocol"),
    minDuration: numberValue(item.min_duration, "minimum duration"),
    maxDuration: numberValue(item.max_duration, "maximum duration"),
    maxAgents: numberValue(item.max_agents, "maximum agents"),
    evaluationGrace: numberValue(item.grace, "evaluation grace"),
    evidenceAuthority: stringValue(item.evidence_authority, "evidence authority"),
    typedPolicyPrefix: stringValue(item.typed_policy_prefix, "typed policy prefix"),
  };
}
export async function getCampaignCount(client = getReadClient()) {
  return numberValue(await read(client, "get_campaign_count"), "campaign count");
}
export async function getCampaign(
  campaignId: string,
  client = getReadClient(),
  includePolicies = true,
): Promise<Campaign> {
  const campaign = mapCampaign(
    await read(client, "get_campaign", [contractId(campaignId, "campaign ID")]),
  );
  if (includePolicies)
    campaign.policies = (
      await getCampaignPolicies(
        campaignId,
        0,
        Math.min(Math.max(campaign.policyCount, 1), 50),
        client,
      )
    ).items.map((item) => item.text);
  return campaign;
}
export async function getCampaigns(
  offset = 0,
  limit = 50,
  client = getReadClient(),
): Promise<Page<Campaign>> {
  const total = await getCampaignCount(client);
  const pageOffset = Number(pageNumber(offset, "campaign offset"));
  const safeOffset = Math.min(pageOffset, total);
  const safeLimit = pageLimit(limit, "campaign limit");
  return getCampaignPage(safeOffset, safeLimit, total, client, false);
}

async function getCampaignPage(
  offset: number,
  limit: number,
  total: number,
  client: GenLayerClient,
  includePolicies: boolean,
): Promise<Page<Campaign>> {
  const safeOffset = offset;
  const safeLimit = pageLimit(limit, "campaign limit");
  const ids = Array.from(
    { length: Math.min(safeLimit, total - safeOffset) },
    (_, index) => safeOffset + index + 1,
  );
  const items = await Promise.all(
    ids.map((id) => getCampaign(String(id), client, includePolicies)),
  );
  return {
    items,
    total,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < total,
  };
}

const CAMPAIGN_PAGE_SIZE = 50;

function sameAddress(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function getAllCampaigns(client: GenLayerClient): Promise<Campaign[]> {
  const total = await getCampaignCount(client);
  if (total === 0) return [];
  const scanLimit = Math.min(total, 200);
  const campaigns: Campaign[] = [];
  for (let offset = 0; offset < scanLimit; offset += CAMPAIGN_PAGE_SIZE) {
    const page = await getCampaignPage(
      offset,
      Math.min(CAMPAIGN_PAGE_SIZE, scanLimit - offset),
      total,
      client,
      false,
    );
    campaigns.push(...page.items);
  }
  return campaigns;
}

function creatorLookupUnsupported(reason: unknown) {
  const text =
    reason instanceof VetoReadError
      ? reason.causeText
      : reason instanceof Error
        ? reason.message
        : String(reason);
  return /method not found|unknown method|function not found|no such method|unsupported method|not implemented|does not exist/i.test(
    text,
  );
}

export async function getMyCampaigns(
  offset = 0,
  limit = 50,
  client = getReadClient(),
  includePolicies = true,
): Promise<Page<Campaign>> {
  const result = page(
    await read(client, "get_my_campaigns", [
      pageNumber(offset, "campaign offset"),
      BigInt(pageLimit(limit, "campaign limit")),
    ]),
    "campaign",
    mapCampaign,
  );
  if (includePolicies)
    await Promise.all(
      result.items.map(async (campaign) => {
        campaign.policies = (
          await getCampaignPolicies(
            campaign.id,
            0,
            Math.min(Math.max(campaign.policyCount, 1), 50),
            client,
          )
        ).items.map((item) => item.text);
      }),
    );
  return result;
}

/**
 * Returns campaigns owned by an explicit wallet address.
 *
 * get_my_campaigns() is sender-scoped in Veto.py. The direct call is useful
 * when the GenLayer client carries the connected account. A successful empty
 * page is authoritative and is not expanded into a public scan. The bounded
 * public fallback is reserved for older deployments that explicitly lack the
 * sender-scoped method, and it filters every returned creator field on-chain.
 */
export async function getCreatorCampaigns(
  creator: string,
  offset = 0,
  limit = 50,
  client = getReadClient(),
  includePolicies = false,
): Promise<Page<Campaign>> {
  let direct: Page<Campaign> | undefined;
  try {
    direct = await getMyCampaigns(offset, limit, client, includePolicies);
  } catch (reason) {
    // A transient or rate-limited sender read must not trigger an unrelated
    // scan of every campaign. Public enumeration is only a compatibility
    // fallback for deployments that explicitly lack get_my_campaigns.
    if (!creatorLookupUnsupported(reason)) throw reason;
  }

  if (direct && direct.items.every((item) => sameAddress(item.creator, creator))) {
    return direct;
  }

  const owned = (await getAllCampaigns(client)).filter((item) =>
    sameAddress(item.creator, creator),
  );
  const safeOffset = Math.min(Number(pageNumber(offset, "campaign offset")), owned.length);
  const safeLimit = pageLimit(limit, "campaign limit");
  const items = owned.slice(safeOffset, safeOffset + safeLimit);
  if (includePolicies)
    await Promise.all(
      items.map(async (campaign) => {
        campaign.policies = (
          await getCampaignPolicies(
            campaign.id,
            0,
            Math.min(Math.max(campaign.policyCount, 1), 50),
            client,
          )
        ).items.map((item) => item.text);
      }),
    );
  return {
    items,
    total: owned.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < owned.length,
  };
}

export async function getCampaignPolicies(
  campaignId: string,
  offset = 0,
  limit = 50,
  client = getReadClient(),
): Promise<Page<{ index: number; text: string; limitWei: bigint }>> {
  return page(
    await read(client, "get_campaign_policies", [
      contractId(campaignId, "campaign ID"),
      pageNumber(offset, "policy offset"),
      BigInt(pageLimit(limit, "policy limit")),
    ]),
    "policy",
    (value) => {
      const item = record(value, "policy");
      return {
        index: numberValue(item.policy_index, "policy index"),
        text: stringValue(item.text, "policy text"),
        limitWei: integer(item.limit_wei, "policy limit"),
      };
    },
  );
}
export async function getCampaignProposals(
  campaignId: string,
  offset = 0,
  limit = 50,
  client = getReadClient(),
): Promise<Page<Proposal>> {
  return page(
    await read(client, "get_campaign_proposals", [
      contractId(campaignId, "campaign ID"),
      pageNumber(offset, "proposal offset"),
      BigInt(pageLimit(limit, "proposal limit")),
    ]),
    "proposal",
    mapProposal,
  );
}
export async function getCampaignParticipants(
  campaignId: string,
  offset = 0,
  limit = 50,
  client = getReadClient(),
) {
  return page(
    await read(client, "get_campaign_participants", [
      contractId(campaignId, "campaign ID"),
      pageNumber(offset, "participant offset"),
      BigInt(pageLimit(limit, "participant limit")),
    ]),
    "participant",
    (value) => {
      const item = record(value, "participant");
      return {
        agentId: String(numberValue(item.agent_id, "participant agent id")),
        challengeId: String(numberValue(item.challenge_id, "participant challenge id")),
        status: stringValue(item.status, "participant status"),
        accepted: booleanValue(item.accepted, "participant acceptance"),
      };
    },
  );
}
export async function getProposal(proposalId: string, client = getReadClient()) {
  return mapProposal(await read(client, "get_proposal", [contractId(proposalId, "proposal ID")]));
}
export async function getProposalChallenges(
  proposalId: string,
  offset = 0,
  limit = 50,
  client = getReadClient(),
): Promise<Page<Challenge>> {
  return page(
    await read(client, "get_proposal_challenges", [
      contractId(proposalId, "proposal ID"),
      pageNumber(offset, "challenge offset"),
      BigInt(pageLimit(limit, "challenge limit")),
    ]),
    "challenge",
    mapChallenge,
  );
}
export async function getChallenge(challengeId: string, client = getReadClient()) {
  return mapChallenge(
    await read(client, "get_challenge", [contractId(challengeId, "challenge ID")]),
  );
}
export async function getAgent(agentId: string, client = getReadClient()) {
  return mapAgent(await read(client, "get_agent", [contractId(agentId, "agent ID")]));
}

export async function getAgentByWallet(walletAddress: string, client = getReadClient()) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) throw new Error("Invalid wallet address.");
  const value = integer(await read(client, "get_agent_by_wallet", [walletAddress]), "agent ID");
  return value === 0n ? undefined : normalizeContractId(value.toString());
}

export type WalletAgentDiscovery = {
  agent: Agent;
  source: "onchain" | "remembered";
};

function walletLookupUnsupported(reason: unknown): boolean {
  const text =
    reason instanceof VetoReadError
      ? reason.causeText
      : reason instanceof Error
        ? reason.message
        : String(reason);
  return /method not found|unknown method|function not found|no such method|unsupported method|not implemented|does not exist/.test(
    text.toLowerCase(),
  );
}

/**
 * Prefer the contract's direct wallet lookup without making cached browser metadata authoritative.
 *
 * The remembered ID remains a compatibility fallback for the historical deployment
 * until a replacement exposing get_agent_by_wallet is configured. Every returned
 * candidate is verified through the live agent record and owner/operator fields.
 */
export async function discoverWalletAgent(
  walletAddress: string,
  rememberedId?: string,
  client = getReadClient(),
): Promise<WalletAgentDiscovery | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return null;

  try {
    const onchainId = await getAgentByWallet(walletAddress, client);
    if (!onchainId) return null;
    const onchainAgent = await getAgent(onchainId, client);
    if (!agentControlsWallet(onchainAgent, walletAddress)) return null;
    return { agent: onchainAgent, source: "onchain" };
  } catch (reason) {
    if (!walletLookupUnsupported(reason)) throw reason;
  }

  if (rememberedId && normalizeContractId(rememberedId)) {
    try {
      const rememberedAgent = await getAgent(normalizeContractId(rememberedId)!, client);
      if (agentControlsWallet(rememberedAgent, walletAddress)) {
        return { agent: rememberedAgent, source: "remembered" };
      }
    } catch (reason) {
      // Unknown or stale cached IDs are rejected. Actual RPC/configuration failures
      // must remain errors and must not be converted into "no agent".
      const text =
        reason instanceof Error ? reason.message.toLowerCase() : String(reason).toLowerCase();
      if (!text.includes("unknown agent")) throw reason;
    }
  }
  return null;
}

export async function getAgentChallenges(
  agentId: string,
  offset = 0,
  limit = 50,
  client = getReadClient(),
): Promise<Page<Challenge>> {
  return page(
    await read(client, "get_agent_challenges", [
      contractId(agentId, "agent ID"),
      pageNumber(offset, "challenge offset"),
      BigInt(pageLimit(limit, "challenge limit")),
    ]),
    "challenge",
    mapChallenge,
  );
}
export async function getAgentCampaignParticipation(
  agentId: string,
  campaignId: string,
  client = getReadClient(),
): Promise<Participation> {
  const item = record(
    await read(client, "get_agent_campaign_participation", [
      contractId(agentId, "agent ID"),
      contractId(campaignId, "campaign ID"),
    ]),
    "participation",
  );
  const challengeId = numberValue(item.challenge_id, "participation challenge id");
  return {
    participated: booleanValue(item.participated, "participation status"),
    challengeId: challengeId === 0 ? null : String(challengeId),
    ...(item.challenge ? { challenge: mapChallenge(item.challenge) } : {}),
  };
}
export async function getAgentCampaignClaimable(
  agentId: string,
  campaignId: string,
  client = getReadClient(),
) {
  return integer(
    await read(client, "get_agent_campaign_claimable", [
      contractId(agentId, "agent ID"),
      contractId(campaignId, "campaign ID"),
    ]),
    "agent campaign claimable",
  );
}
export async function getPendingChallengeCount(proposalId: string, client = getReadClient()) {
  return numberValue(
    await read(client, "get_pending_challenge_count", [contractId(proposalId, "proposal ID")]),
    "pending challenge count",
  );
}
export async function getGlobalAccounting(client = getReadClient()): Promise<GlobalAccounting> {
  const item = record(await read(client, "get_global_accounting"), "global accounting");
  return {
    rewardFunded: integer(item.reward_funded, "reward funded"),
    rewardReserved: integer(item.reward_reserved, "reward reserved"),
    rewardClaimable: integer(item.reward_claimable, "reward claimable"),
    rewardPaid: integer(item.reward_paid, "reward paid"),
    rewardRefunded: integer(item.reward_refunded, "reward refunded"),
    rewardAvailable: integer(item.reward_available, "reward available"),
    escrowFunded: integer(item.escrow_funded, "escrow funded"),
    escrowLocked: integer(item.escrow_locked, "escrow locked"),
    escrowPaid: integer(item.escrow_paid, "escrow paid"),
    escrowRefunded: integer(item.escrow_refunded, "escrow refunded"),
    accountedContractBalance: integer(item.accounted_contract_balance, "accounted balance"),
  };
}

export function createCampaignWrite(input: {
  name: string;
  description: string;
  policies: string[];
  maxAgents: number;
  reward: bigint;
  durationSeconds: number;
}): ContractWrite {
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "create_campaign",
    args: [
      input.name,
      input.description,
      input.policies.join("\n"),
      BigInt(input.maxAgents),
      input.reward,
      BigInt(input.durationSeconds),
    ],
    value: BigInt(input.maxAgents) * input.reward,
  };
}
export function registerAgentWrite(
  name: string,
  description: string,
  operator: string,
  payout: string,
): ContractWrite {
  if (!isAddress(operator)) throw new Error("Operator must be a valid 0x address.");
  if (!isAddress(payout)) throw new Error("Payout must be a valid 0x address.");
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "register_agent",
    args: [name, description, operator, payout],
  };
}
export function updateAgentWrite(
  agentId: string,
  name: string,
  description: string,
  operator: string,
  payout: string,
  active: boolean,
): ContractWrite {
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "update_agent",
    args: [BigInt(agentId), name, description, operator, payout, active],
  };
}
export function addProposalWrite(
  campaignId: string,
  title: string,
  description: string,
  recipient: string,
  amount: bigint,
  policyIndex: number,
): ContractWrite {
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "add_proposal",
    args: [BigInt(campaignId), title, description, recipient, amount, BigInt(policyIndex)],
    value: amount,
  };
}
export function submitChallengeWrite(
  proposalId: string,
  agentId: string,
  allegation: string,
  explanation: string,
  evidenceUrl: string,
): ContractWrite {
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "submit_challenge",
    args: [BigInt(proposalId), BigInt(agentId), allegation, explanation, evidenceUrl],
  };
}
export function publishAttestationWrite(
  campaignId: string,
  proposalId: string,
  policyIndex: number,
  evidenceSha256: string,
  expiresAt: bigint,
): ContractWrite {
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "publish_attestation",
    args: [BigInt(campaignId), BigInt(proposalId), BigInt(policyIndex), evidenceSha256, expiresAt],
  };
}
export function simpleWrite(
  method:
    | "evaluate_challenge"
    | "resolve_proposal"
    | "execute_proposal"
    | "claim_proposal_refund"
    | "close_campaign"
    | "claim_campaign_remainder",
  id: string,
): ContractWrite {
  return { kind: "write", address: vetoContractAddress, method, args: [BigInt(id)] };
}
export function claimRewardWrite(agentId: string, campaignId: string): ContractWrite {
  return {
    kind: "write",
    address: vetoContractAddress,
    method: "claim_reward",
    args: [BigInt(agentId), BigInt(campaignId)],
  };
}
