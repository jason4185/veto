import { createClient } from "genlayer-js";
import type { Address } from "viem";
import { STUDIO_NEXT_CHAIN_ID } from "./domain";
import { assertVetoConfiguration, studioNext, type BrowserProvider } from "./network";
import { runRpcRequest } from "./rpc";

export type GenLayerClient = ReturnType<typeof createClient>;
let readClient: GenLayerClient | undefined;

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
  return runRpcRequest({
    key: `transaction:${STUDIO_NEXT_CHAIN_ID}:${sender}:${hash.toLowerCase()}`,
    method: "getTransaction",
    request: () => client.getTransaction({ hash: hash as never }),
  });
}

export function getInjectedProvider(): BrowserProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: BrowserProvider }).ethereum;
}
