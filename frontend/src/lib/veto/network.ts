import { studioDevnet } from "genlayer-js/chains";
import type { GenLayerChain, Eip1193Provider } from "@genlayer/transaction-kit";
import { isAddress, type Address } from "viem";
import {
  STUDIO_NEXT_CHAIN_ID,
  STUDIO_NEXT_EXPLORER_URL,
  STUDIO_NEXT_RPC_URL,
  STUDIO_NEXT_CHAIN_HEX,
  VETO_CONTRACT_ADDRESS,
  VETO_CONFIGURATION_ERROR,
} from "./domain";

export type BrowserProvider = Eip1193Provider;
export const studioNext = {
  ...studioDevnet,
  id: STUDIO_NEXT_CHAIN_ID,
  name: "GenLayer Studio Next",
  rpcUrls: { default: { http: [STUDIO_NEXT_RPC_URL] } },
  blockExplorers: {
    default: { name: "GenLayer Studio Explorer", url: STUDIO_NEXT_EXPLORER_URL },
  },
} satisfies GenLayerChain;

export const vetoContractAddress = (
  VETO_CONTRACT_ADDRESS && isAddress(VETO_CONTRACT_ADDRESS)
    ? VETO_CONTRACT_ADDRESS
    : "0x0000000000000000000000000000000000000000"
) as Address;

export function explorerTransactionUrl(txId: string) {
  return `${STUDIO_NEXT_EXPLORER_URL}/tx/${txId}`;
}

export function explorerAddressUrl(address: string) {
  return `${STUDIO_NEXT_EXPLORER_URL}/address/${address}`;
}

export function assertVetoConfiguration() {
  if (VETO_CONFIGURATION_ERROR) throw new Error(VETO_CONFIGURATION_ERROR);
}

export { STUDIO_NEXT_CHAIN_HEX };
