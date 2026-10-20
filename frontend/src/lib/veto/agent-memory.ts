import type { Agent } from "./domain";
import {
  isAddress,
  normalizeContractId,
  STUDIO_NEXT_CHAIN_ID,
  VETO_CONTRACT_ADDRESS,
} from "./domain";

const STORAGE_PREFIX = "veto:known-agent-id:v2";

export type AgentAssociationScope = {
  chainId?: number;
  contractAddress?: string;
};

function storage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function scopedKey(address: string, scope?: AgentAssociationScope): string | undefined {
  const chainId = scope?.chainId ?? STUDIO_NEXT_CHAIN_ID;
  const contractAddress = scope?.contractAddress ?? VETO_CONTRACT_ADDRESS;
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    !contractAddress ||
    !isAddress(contractAddress)
  ) {
    return undefined;
  }
  return `${STORAGE_PREFIX}:${chainId}:${contractAddress.toLowerCase()}:${address.toLowerCase()}`;
}

/** Metadata only: callers must always verify the ID with get_agent before using it. */
export function readKnownAgentId(
  address: string | undefined,
  scope?: AgentAssociationScope,
): string | undefined {
  if (!address || !isAddress(address)) return undefined;
  const key = scopedKey(address, scope);
  const store = storage();
  if (!key || !store) return undefined;
  try {
    return normalizeContractId(store.getItem(key) ?? undefined);
  } catch {
    return undefined;
  }
}

/** Store a verified navigation hint, never an identity or eligibility assertion. */
export function rememberKnownAgentId(
  address: string | undefined,
  agentId: string,
  scope?: AgentAssociationScope,
): boolean {
  if (!address || !isAddress(address)) return false;
  const id = normalizeContractId(agentId);
  const key = scopedKey(address, scope);
  const store = storage();
  if (!id || !key || !store) return false;
  try {
    store.setItem(key, id);
    return true;
  } catch {
    return false;
  }
}

export function forgetKnownAgentId(
  address: string | undefined,
  scope?: AgentAssociationScope,
): boolean {
  if (!address || !isAddress(address)) return false;
  const key = scopedKey(address, scope);
  const store = storage();
  if (!key || !store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Save a verified agent for its owner and current operator, never its payout address. */
export function rememberKnownAgentIds(
  addresses: Array<string | undefined>,
  agentId: string,
  scope?: AgentAssociationScope,
): boolean {
  const uniqueAddresses = [
    ...new Set(addresses.filter((address): address is string => Boolean(address))),
  ];
  if (uniqueAddresses.length === 0) return false;
  return uniqueAddresses.every((address) => rememberKnownAgentId(address, agentId, scope));
}

/** Convenience wrapper for a live agent already verified through get_agent. */
export function rememberVerifiedAgent(
  agent: Pick<Agent, "owner" | "operator">,
  agentId: string,
  scope?: AgentAssociationScope,
): boolean {
  return rememberKnownAgentIds([agent.owner, agent.operator], agentId, scope);
}
