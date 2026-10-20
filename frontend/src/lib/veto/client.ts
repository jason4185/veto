import { createClient } from "genlayer-js";
import type { Address } from "viem";
import { STUDIO_NEXT_CHAIN_ID } from "./domain";
import { assertVetoConfiguration, studioNext, type BrowserProvider } from "./network";
import { runRpcRequest } from "./rpc";

export type GenLayerClient = ReturnType<typeof createClient>;
let readClient: GenLayerClient | undefined;
const FINAL_RECEIPT_CACHE_MS = 5 * 60_000;
const finalReceiptCache = new WeakMap<object, Map<string, { value: unknown; expiresAt: number }>>();
type VetoTransaction = Awaited<ReturnType<GenLayerClient["getTransaction"]>>;

function finalized(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { statusName?: unknown }).statusName === "FINALIZED",
  );
}

export function getReadClient() {
  assertVetoConfiguration();
  readClient ??= createClient({ chain: studioNext });
  return readClient;
}

export function getConnectedClient(provider: BrowserProvider, account: Address) {
  assertVetoConfiguration();
  return createClient({ chain: studioNext, provider, account });
}

export function getVetoTransaction(client: GenLayerClient, hash: string) {
  const sender = client.account?.address?.toLowerCase() ?? "public";
  const cacheKey = hash.toLowerCase();
  const clientCache = finalReceiptCache.get(client as object);
  const cached = clientCache?.get(cacheKey);
  if (cached && cached.expiresAt > Date.now())
    return Promise.resolve(cached.value as VetoTransaction);
  clientCache?.delete(cacheKey);
  return runRpcRequest({
    key: `transaction:${STUDIO_NEXT_CHAIN_ID}:${sender}:${hash.toLowerCase()}`,
    method: "getTransaction",
    context: {
      source: "transaction.receipt",
      queryKey: "getTransaction",
      trigger: "finality",
      necessary: true,
    },
    request: async (): Promise<VetoTransaction> => {
      const value = await client.getTransaction({ hash: hash as never });
      if (finalized(value)) {
        const cache = finalReceiptCache.get(client as object) ?? new Map();
        cache.set(cacheKey, { value, expiresAt: Date.now() + FINAL_RECEIPT_CACHE_MS });
        finalReceiptCache.set(client as object, cache);
      }
      return value;
    },
  });
}

export function getInjectedProvider(): BrowserProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: BrowserProvider }).ethereum;
}
