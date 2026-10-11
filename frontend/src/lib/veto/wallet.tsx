import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createTransactionKit, type TransactionKit } from "@genlayer/transaction-kit";
import type { Address } from "viem";
import { getConnectedClient, getInjectedProvider, type GenLayerClient } from "./client";
import {
  chainConfig,
  STUDIO_NEXT_CHAIN_HEX,
  STUDIO_NEXT_EXPLORER_URL,
  STUDIO_NEXT_RPC_URL,
} from "./domain";
import { normalizeVetoError, VetoError } from "./errors";
import { studioNext, type BrowserProvider } from "./network";

type WalletStatus = "disconnected" | "connecting" | "connected" | "wrong-network";
export interface WalletState {
  address?: Address;
  chainId?: number;
  status: WalletStatus;
  busy: boolean;
  error?: VetoError;
  provider?: BrowserProvider;
  kit?: TransactionKit;
  connectedClient?: GenLayerClient;
  connect: () => Promise<void>;
  disconnect: () => Promise<boolean>;
  switchToStudioNext: () => Promise<void>;
  switchChain: () => Promise<void>;
}

const WalletContext = createContext<WalletState | undefined>(undefined);

function addressValue(value: unknown): Address | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as Address)
    : undefined;
}

function chainValue(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  const parsed = Number.parseInt(text, text.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readWallet(provider: BrowserProvider) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  const account = Array.isArray(accounts) ? addressValue(accounts[0]) : undefined;
  return { address: account, chainId: chainValue(chain) };
}

async function switchWallet(provider: BrowserProvider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIO_NEXT_CHAIN_HEX }],
    });
  } catch (reason) {
    if ((reason as { code?: number }).code !== 4902) throw reason;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: STUDIO_NEXT_CHAIN_HEX,
          chainName: chainConfig.name,
          rpcUrls: [STUDIO_NEXT_RPC_URL],
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          blockExplorerUrls: [STUDIO_NEXT_EXPLORER_URL],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIO_NEXT_CHAIN_HEX }],
    });
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<BrowserProvider>();
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<VetoError>();

  const refresh = useCallback(async (nextProvider: BrowserProvider) => {
    const result = await readWallet(nextProvider);
    setProvider(nextProvider);
    setAddress(result.address);
    setChainId(result.chainId);
    setStatus(
      result.address
        ? result.chainId === chainConfig.chainId
          ? "connected"
          : "wrong-network"
        : "disconnected",
    );
  }, []);

  useEffect(() => {
    const injected = getInjectedProvider();
    if (!injected) return;
    void refresh(injected).catch((reason) => setError(normalizeVetoError(reason)));
    const onAccountsChanged = () =>
      void refresh(injected).catch((reason) => setError(normalizeVetoError(reason)));
    const onChainChanged = () =>
      void refresh(injected).catch((reason) => setError(normalizeVetoError(reason)));
    const emitter = injected as BrowserProvider & {
      on?: (event: string, listener: () => void) => void;
      removeListener?: (event: string, listener: () => void) => void;
    };
    emitter.on?.("accountsChanged", onAccountsChanged);
    emitter.on?.("chainChanged", onChainChanged);
    return () => {
      emitter.removeListener?.("accountsChanged", onAccountsChanged);
      emitter.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    const injected = getInjectedProvider();
    if (!injected) {
      setError(
        new VetoError(
          "No browser wallet was detected. Install an injected EIP-1193 wallet such as MetaMask to continue.",
          "configuration",
          "window.ethereum is unavailable",
          "Install a browser wallet, then reload this page.",
        ),
      );
      return;
    }
    setStatus("connecting");
    setError(undefined);
    try {
      await injected.request({ method: "eth_requestAccounts" });
      await refresh(injected);
    } catch (reason) {
      setStatus("disconnected");
      setError(normalizeVetoError(reason));
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    setAddress(undefined);
    setChainId(undefined);
    setStatus("disconnected");
    setError(undefined);
    return true;
  }, []);

  const switchToStudioNext = useCallback(async () => {
    const injected = provider ?? getInjectedProvider();
    if (!injected) return connect();
    setError(undefined);
    try {
      await switchWallet(injected);
      await refresh(injected);
    } catch (reason) {
      setError(normalizeVetoError(reason));
    }
  }, [connect, provider, refresh]);

  const kit = useMemo<TransactionKit | undefined>(
    () =>
      provider && address && status === "connected"
        ? createTransactionKit({ chain: studioNext, provider, account: address })
        : undefined,
    [provider, address, status],
  );
  const connectedClient = useMemo(
    () =>
      provider && address && status === "connected"
        ? getConnectedClient(provider, address)
        : undefined,
    [provider, address, status],
  );
  const value = useMemo<WalletState>(
    () => ({
      status,
      busy: status === "connecting",
      connect,
      disconnect,
      switchToStudioNext,
      switchChain: switchToStudioNext,
      ...(address ? { address } : {}),
      ...(chainId === undefined ? {} : { chainId }),
      ...(error ? { error } : {}),
      ...(provider ? { provider } : {}),
      ...(kit ? { kit } : {}),
      ...(connectedClient ? { connectedClient } : {}),
    }),
    [
      address,
      chainId,
      status,
      error,
      provider,
      kit,
      connectedClient,
      connect,
      disconnect,
      switchToStudioNext,
    ],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("WalletProvider is required.");
  return value;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
