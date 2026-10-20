import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { chainConfig, connectionState, isContractId } from "./domain";
import type { GenLayerClient } from "./client";
import type { ContractWrite } from "./contract";
import type { Challenge, Proposal } from "./domain";
import { normalizeVetoError } from "./errors";
import { rateLimitCooldownMs } from "./rpc";
import {
  getAgent,
  getAgentCampaignClaimable,
  getAgentCampaignParticipation,
  getAgentChallenges,
  getCampaign,
  getCampaignProposals,
  getCampaigns,
  getConfig,
  getGlobalAccounting,
  getProposal,
  getProposalChallenges,
  getChallenge,
  getPendingChallengeCount,
  getCreatorCampaigns,
  getCampaignParticipants,
  discoverWalletAgent,
  VETO_READ_STATE,
} from "./contract";
import { forgetKnownAgentId, readKnownAgentId, rememberKnownAgentId } from "./agent-memory";

const enabled = connectionState === "ready";
const contractScope = chainConfig.contract?.toLowerCase() ?? "unconfigured";
export const vetoQueryKey = (resource: string, ...parts: unknown[]) => [
  "veto",
  resource,
  contractScope,
  chainConfig.chainId,
  VETO_READ_STATE,
  ...parts,
];

function cached<T>(queryClient: QueryClient | undefined, key: QueryKey): T | undefined {
  return queryClient?.getQueryData<T>(key);
}

function cachedResourceKeys(queryClient: QueryClient | undefined, resource: string) {
  return (
    queryClient
      ?.getQueryCache()
      .findAll({ queryKey: vetoQueryKey(resource) })
      .map((query) => query.queryKey) ?? []
  );
}

export function invalidationKeysForWrite(
  write: ContractWrite | null | undefined,
  queryClient?: QueryClient,
): QueryKey[] {
  if (!write) return [];
  const id =
    typeof write.args[0] === "bigint" ? write.args[0].toString() : String(write.args[0] ?? "");
  const secondId =
    typeof write.args[1] === "bigint" ? write.args[1].toString() : String(write.args[1] ?? "");
  const campaignId = id;
  const proposalId = id;
  const challengeId = id;
  switch (write.method) {
    case "register_agent":
      return [vetoQueryKey("wallet-agent")];
    case "update_agent":
      return [
        vetoQueryKey("agent", id),
        vetoQueryKey("wallet-agent"),
        vetoQueryKey("agent-challenges", id),
      ];
    case "create_campaign":
      return [
        ...cachedResourceKeys(queryClient, "campaigns"),
        vetoQueryKey("my-campaigns"),
        vetoQueryKey("accounting"),
      ];
    case "add_proposal":
      return [
        vetoQueryKey("campaign", campaignId),
        vetoQueryKey("campaign-proposals", campaignId),
        vetoQueryKey("participants", campaignId),
        vetoQueryKey("my-campaigns"),
        vetoQueryKey("accounting"),
        ...cachedResourceKeys(queryClient, "campaigns"),
      ];
    case "submit_challenge": {
      const proposal = cached<Proposal>(queryClient, vetoQueryKey("proposal", proposalId));
      const relatedCampaignId = proposal?.campaignId;
      return [
        vetoQueryKey("proposal", proposalId),
        vetoQueryKey("proposal-challenges", proposalId),
        vetoQueryKey("pending-challenges", proposalId),
        vetoQueryKey("agent", secondId),
        vetoQueryKey("agent-challenges", secondId),
        ...(relatedCampaignId
          ? [
              vetoQueryKey("campaign", relatedCampaignId),
              vetoQueryKey("campaign-proposals", relatedCampaignId),
              vetoQueryKey("participants", relatedCampaignId),
              vetoQueryKey("participation", secondId, relatedCampaignId),
            ]
          : []),
      ];
    }
    case "publish_attestation":
      return [
        vetoQueryKey("proposal", secondId),
        vetoQueryKey("proposal-challenges", secondId),
        vetoQueryKey("campaign", campaignId),
        vetoQueryKey("campaign-proposals", campaignId),
      ];
    case "evaluate_challenge": {
      const challenge = cached<Challenge>(queryClient, vetoQueryKey("challenge", challengeId));
      return [
        vetoQueryKey("challenge", challengeId),
        ...(challenge
          ? [
              vetoQueryKey("proposal", challenge.proposalId),
              vetoQueryKey("proposal-challenges", challenge.proposalId),
              vetoQueryKey("pending-challenges", challenge.proposalId),
              vetoQueryKey("campaign", challenge.campaignId),
              vetoQueryKey("campaign-proposals", challenge.campaignId),
              vetoQueryKey("participants", challenge.campaignId),
              vetoQueryKey("agent", challenge.agentId),
              vetoQueryKey("agent-challenges", challenge.agentId),
            ]
          : []),
      ];
    }
    case "resolve_proposal": {
      const proposal = cached<Proposal>(queryClient, vetoQueryKey("proposal", proposalId));
      return [
        vetoQueryKey("proposal", proposalId),
        vetoQueryKey("proposal-challenges", proposalId),
        ...(proposal
          ? [
              vetoQueryKey("campaign", proposal.campaignId),
              vetoQueryKey("campaign-proposals", proposal.campaignId),
              vetoQueryKey("participants", proposal.campaignId),
            ]
          : []),
        vetoQueryKey("accounting"),
      ];
    }
    case "execute_proposal":
    case "claim_proposal_refund":
      return [
        vetoQueryKey("proposal", proposalId),
        ...(cached<Proposal>(queryClient, vetoQueryKey("proposal", proposalId))?.campaignId
          ? [
              vetoQueryKey(
                "campaign",
                cached<Proposal>(queryClient, vetoQueryKey("proposal", proposalId))!.campaignId,
              ),
              vetoQueryKey(
                "campaign-proposals",
                cached<Proposal>(queryClient, vetoQueryKey("proposal", proposalId))!.campaignId,
              ),
            ]
          : []),
        vetoQueryKey("my-campaigns"),
        vetoQueryKey("accounting"),
      ];
    case "close_campaign":
    case "claim_campaign_remainder":
      return [
        vetoQueryKey("campaign", campaignId),
        ...cachedResourceKeys(queryClient, "campaigns"),
        vetoQueryKey("my-campaigns"),
        vetoQueryKey("accounting"),
      ];
    case "claim_reward":
      return [
        vetoQueryKey("agent", id),
        vetoQueryKey("agent-claimable", id, secondId),
        vetoQueryKey("participation", id, secondId),
        vetoQueryKey("campaign", secondId),
        vetoQueryKey("accounting"),
      ];
    default:
      return [vetoQueryKey("accounting")];
  }
}

export async function invalidateVetoQueries(queryClient: QueryClient, keys: QueryKey[]) {
  const unique = new Map(keys.map((key) => [JSON.stringify(key), key]));
  await Promise.all(
    [...unique.values()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, refetchType: "active" }),
    ),
  );
}
export function shouldRetryVetoRead(failureCount: number, error: unknown) {
  const normalized = normalizeVetoError(error);
  if (normalized.kind !== "rpc_unavailable" && normalized.kind !== "rate_limited") return false;
  return failureCount < 1;
}
const options = {
  retry: shouldRetryVetoRead,
  retryDelay: (attempt: number, error: unknown) => {
    if (normalizeVetoError(error).kind === "rate_limited")
      return Math.min(Math.max(rateLimitCooldownMs(error), 1_000), 120_000);
    return Math.min(1_000 * 2 ** attempt, 5_000) + Math.floor(Math.random() * 250);
  },
  staleTime: 30_000,
  gcTime: 10 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};

export function useVetoConfig() {
  return useQuery({
    queryKey: vetoQueryKey("config"),
    queryFn: () => getConfig(),
    enabled,
    ...options,
    // A wallet reconnect must re-check the live owner/operator mapping. The shared
    // RPC layer still deduplicates simultaneous reads and there is no polling.
    staleTime: 0,
  });
}
export function useCampaigns(offset = 0, limit = 50) {
  return useQuery({
    queryKey: vetoQueryKey("campaigns", offset, limit),
    queryFn: () => getCampaigns(offset, limit),
    enabled,
    ...options,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
export function useMyCampaigns(
  offset = 0,
  limit = 50,
  creatorAddress?: string,
  client?: GenLayerClient,
) {
  const walletReady = Boolean(creatorAddress && client);
  return useQuery({
    queryKey: vetoQueryKey(
      "my-campaigns",
      creatorAddress?.toLowerCase() ?? "disconnected",
      offset,
      limit,
    ),
    queryFn: () => {
      if (!creatorAddress || !client)
        throw new Error("Connect a wallet to read creator campaigns.");
      return getCreatorCampaigns(creatorAddress, offset, limit, client);
    },
    enabled: enabled && walletReady,
    ...options,
    staleTime: 30_000,
    refetchInterval: false,
  });
}
export function useCampaign(id: string) {
  return useQuery({
    queryKey: vetoQueryKey("campaign", id),
    queryFn: () => getCampaign(id),
    enabled: enabled && isContractId(id),
    ...options,
  });
}
export function useCampaignProposals(id: string, offset = 0, limit = 50) {
  return useQuery({
    queryKey: vetoQueryKey("campaign-proposals", id, offset, limit),
    queryFn: () => getCampaignProposals(id, offset, limit),
    enabled: enabled && isContractId(id),
    ...options,
    placeholderData: keepPreviousData,
  });
}
export function useCampaignParticipants(id: string, offset = 0, limit = 50) {
  return useQuery({
    queryKey: vetoQueryKey("participants", id, offset, limit),
    queryFn: () => getCampaignParticipants(id, offset, limit),
    enabled: enabled && isContractId(id),
    ...options,
    placeholderData: keepPreviousData,
  });
}
export function useProposal(id: string) {
  return useQuery({
    queryKey: vetoQueryKey("proposal", id),
    queryFn: () => getProposal(id),
    enabled: enabled && isContractId(id),
    ...options,
  });
}
export function useProposalChallenges(id: string, offset = 0, limit = 50) {
  return useQuery({
    queryKey: vetoQueryKey("proposal-challenges", id, offset, limit),
    queryFn: () => getProposalChallenges(id, offset, limit),
    enabled: enabled && isContractId(id),
    ...options,
    placeholderData: keepPreviousData,
  });
}
export function usePendingChallengeCount(id: string) {
  return useQuery({
    queryKey: vetoQueryKey("pending-challenges", id),
    queryFn: () => getPendingChallengeCount(id),
    enabled: enabled && isContractId(id),
    ...options,
  });
}
export function useChallenge(id: string) {
  return useQuery({
    queryKey: vetoQueryKey("challenge", id),
    queryFn: () => getChallenge(id),
    enabled: enabled && isContractId(id),
    ...options,
  });
}
export function useAgent(id: string) {
  return useQuery({
    queryKey: vetoQueryKey("agent", id),
    queryFn: () => getAgent(id),
    enabled: enabled && isContractId(id),
    ...options,
  });
}

export function walletAgentQueryKey(address?: string, chainId?: number): QueryKey {
  return vetoQueryKey(
    "wallet-agent",
    address?.toLowerCase() ?? "disconnected",
    chainId ?? "unknown",
  );
}

export function useWalletAgent(address?: string, chainId?: number) {
  return useQuery({
    queryKey: walletAgentQueryKey(address, chainId),
    queryFn: async () => {
      if (!address) return null;
      const rememberedId = readKnownAgentId(address);
      const discovered = await discoverWalletAgent(address, rememberedId);
      if (discovered) {
        rememberKnownAgentId(address, discovered.agent.id);
      } else if (rememberedId) {
        forgetKnownAgentId(address);
      }
      return discovered;
    },
    enabled: enabled && Boolean(address) && chainId === chainConfig.chainId,
    ...options,
    // The key is stable across the local metadata write after discovery. This
    // avoids a second lookup while still separating wallets and deployments.
    // Results are cached briefly; wallet changes produce a different key.
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}
export function useAgentChallenges(id: string, offset = 0, limit = 50) {
  return useQuery({
    queryKey: vetoQueryKey("agent-challenges", id, offset, limit),
    queryFn: () => getAgentChallenges(id, offset, limit),
    enabled: enabled && isContractId(id),
    ...options,
    placeholderData: keepPreviousData,
  });
}
export function useParticipation(agentId: string, campaignId: string) {
  return useQuery({
    queryKey: vetoQueryKey("participation", agentId, campaignId),
    queryFn: () => getAgentCampaignParticipation(agentId, campaignId),
    enabled: enabled && isContractId(agentId) && isContractId(campaignId),
    ...options,
  });
}
export function useAgentCampaignClaimable(agentId: string, campaignId: string) {
  return useQuery({
    queryKey: vetoQueryKey("agent-claimable", agentId, campaignId),
    queryFn: () => getAgentCampaignClaimable(agentId, campaignId),
    enabled: enabled && isContractId(agentId) && isContractId(campaignId),
    ...options,
  });
}
export function useAccounting() {
  return useQuery({
    queryKey: vetoQueryKey("accounting"),
    queryFn: () => getGlobalAccounting(),
    enabled,
    ...options,
  });
}
