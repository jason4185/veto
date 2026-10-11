import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { chainConfig, connectionState, isContractId } from "./domain";
import type { GenLayerClient } from "./client";
import { normalizeVetoError } from "./errors";
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
} from "./contract";
import { readKnownAgentId, rememberKnownAgentId } from "./agent-memory";

const enabled = connectionState === "ready";
const contractScope = chainConfig.contract?.toLowerCase() ?? "unconfigured";
export const vetoQueryKey = (resource: string, ...parts: unknown[]) => [
  "veto",
  resource,
  contractScope,
  chainConfig.chainId,
  ...parts,
];
export function shouldRetryVetoRead(failureCount: number, error: unknown) {
  const normalized = normalizeVetoError(error);
  if (normalized.kind !== "rpc_unavailable") return false;
  if (/rate limit|too many requests|\b429\b/i.test(normalized.technicalMessage)) return false;
  return failureCount < 2;
}
const options = {
  retry: shouldRetryVetoRead,
  retryDelay: (attempt: number) => Math.min(500 * 2 ** attempt, 2_000),
  staleTime: 10_000,
  refetchOnWindowFocus: true,
};

export function useVetoConfig() {
  return useQuery({
    queryKey: vetoQueryKey("config"),
    queryFn: () => getConfig(),
    enabled,
    ...options,
  });
}
export function useCampaigns(offset = 0, limit = 50) {
  return useQuery({
    queryKey: vetoQueryKey("campaigns", offset, limit),
    queryFn: () => getCampaigns(offset, limit),
    enabled,
    ...options,
    placeholderData: keepPreviousData,
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
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
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

export function useWalletAgent(address?: string, chainId?: number) {
  const rememberedId = readKnownAgentId(address);
  return useQuery({
    queryKey: vetoQueryKey(
      "wallet-agent",
      address?.toLowerCase() ?? "disconnected",
      chainId ?? "unknown",
      rememberedId ?? "unremembered",
    ),
    queryFn: async () => {
      if (!address) return null;
      const discovered = await discoverWalletAgent(address, rememberedId);
      if (discovered) rememberKnownAgentId(address, discovered.agent.id);
      return discovered;
    },
    enabled: enabled && Boolean(address),
    ...options,
    staleTime: 60_000,
    refetchInterval: false,
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
