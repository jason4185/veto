import { isAddress, normalizeContractId } from "./domain";

const STORAGE_KEY = "veto:known-agent-ids:v1";

function storage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function read(): Record<string, string> {
  const store = storage();
  if (!store) return {};
  try {
    const value: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([address, id]) => isAddress(address) && typeof id === "string" && normalizeContractId(id),
      ),
    );
  } catch {
    return {};
  }
}

/** Metadata only: callers must always verify the ID with get_agent before using it. */
export function readKnownAgentId(address: string | undefined): string | undefined {
  if (!address || !isAddress(address)) return undefined;
  return normalizeContractId(read()[address.toLowerCase()]);
}

/** Store a verified navigation hint, never an identity or eligibility assertion. */
export function rememberKnownAgentId(address: string | undefined, agentId: string): boolean {
  if (!address || !isAddress(address)) return false;
  const id = normalizeContractId(agentId);
  const store = storage();
  if (!id || !store) return false;
  const values = read();
  values[address.toLowerCase()] = id;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(values));
    return true;
  } catch {
    return false;
  }
}
