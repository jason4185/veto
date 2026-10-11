import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TrackedStatus, TransactionKit } from "@genlayer/transaction-kit";
import { isSuccessful } from "genlayer-js";
import { explorerTransactionUrl, vetoContractAddress } from "./network";
import { getVetoTransaction, type GenLayerClient } from "./client";
import { useWallet } from "./wallet";
import { invalidateVetoQueries, invalidationKeysForWrite } from "./hooks";
import { isRpcRateLimitError, rateLimitCooldownMs } from "./rpc";

const STORAGE_KEY = "veto.pending-transactions.v1";

export type PendingTransaction = {
  id: `0x${string}`;
  method: string;
  submittedAt: number;
  phase: TrackedStatus["phase"];
  statusName?: string;
  executionResultName?: string;
  successful?: boolean;
  args?: unknown[];
};

type Listener = {
  onStatus?: (status: TrackedStatus) => void;
  onFinalized?: (status: TrackedStatus) => void;
  onError?: (error: Error) => void;
};

const subscribers = new Set<() => void>();
const transactionListeners = new Map<string, Set<Listener>>();
const activeMonitors = new Map<string, Promise<void>>();
const monitorRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const monitorRetryCounts = new Map<string, number>();
const MAX_RATE_LIMIT_RETRIES = 5;

function notify() {
  subscribers.forEach((listener) => listener());
}

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readPendingTransactions(): PendingTransaction[] {
  const storage = browserStorage();
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is PendingTransaction =>
        Boolean(value) &&
        typeof value === "object" &&
        /^0x[0-9a-f]+$/iu.test(String((value as { id?: unknown }).id ?? "")) &&
        typeof (value as { method?: unknown }).method === "string" &&
        typeof (value as { submittedAt?: unknown }).submittedAt === "number" &&
        typeof (value as { phase?: unknown }).phase === "string" &&
        ((value as { args?: unknown }).args === undefined ||
          Array.isArray((value as { args?: unknown }).args)),
    );
  } catch {
    return [];
  }
}

function writePendingTransactions(records: PendingTransaction[]) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Tracking metadata is best effort and never replaces contract state.
  }
  notify();
}

export function rememberPendingTransaction(
  id: `0x${string}`,
  method: string,
  status: TrackedStatus,
  args: unknown[] = [],
) {
  const records = readPendingTransactions();
  const next: PendingTransaction = {
    id,
    method,
    submittedAt: Date.now(),
    phase: status.phase,
    ...(status.statusName ? { statusName: status.statusName } : {}),
    ...(status.executionResultName ? { executionResultName: status.executionResultName } : {}),
    ...(status.successful === undefined ? {} : { successful: status.successful }),
    args: args.map((value) => (typeof value === "bigint" ? value.toString() : value)),
  };
  writePendingTransactions([next, ...records.filter((record) => record.id !== id)]);
}

function updatePendingTransaction(id: string, status: TrackedStatus) {
  const records = readPendingTransactions();
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return;
  const current = records[index];
  if (!current) return;
  const next = {
    ...current,
    phase: status.phase,
    ...(status.statusName ? { statusName: status.statusName } : {}),
    ...(status.executionResultName ? { executionResultName: status.executionResultName } : {}),
    ...(status.successful === undefined ? {} : { successful: status.successful }),
  } satisfies PendingTransaction;
  records[index] = next;
  writePendingTransactions(records);
}

function removePendingTransaction(id: string) {
  writePendingTransactions(readPendingTransactions().filter((record) => record.id !== id));
}

function notifyTransaction(id: string, event: keyof Listener, value: TrackedStatus | Error) {
  transactionListeners.get(id)?.forEach((listener) => {
    const callback = listener[event];
    if (callback) callback(value as never);
  });
}

async function monitor(id: `0x${string}`, kit: TransactionKit, client: GenLayerClient) {
  let latest: TrackedStatus = { phase: "submitted", genlayerTxId: id };
  try {
    const terminal = await kit.track(
      id,
      (status) => {
        latest = status;
        monitorRetryCounts.delete(id);
        updatePendingTransaction(id, status);
        notifyTransaction(id, "onStatus", status);
      },
      { until: "finalized" },
    );
    latest = terminal;
    const transaction = await getVetoTransaction(client, id);
    if (terminal.phase !== "finalized" || terminal.statusName !== "FINALIZED") {
      throw new Error("GenLayer returned an unfinalized terminal status.");
    }
    if (!isSuccessful(transaction)) {
      throw new Error(
        `Finalized transaction execution failed: ${transaction.txExecutionResultName ?? transaction.statusName ?? "unknown outcome"}.`,
      );
    }
    removePendingTransaction(id);
    monitorRetryCounts.delete(id);
    notifyTransaction(id, "onFinalized", terminal);
  } catch (reason) {
    if (latest.phase === "finalized") removePendingTransaction(id);
    const error = reason instanceof Error ? reason : new Error(String(reason));
    notifyTransaction(id, "onError", error);
    if (isRpcRateLimitError(reason)) scheduleRateLimitedRetry(id, kit, client, reason);
  }
}

function startMonitor(id: `0x${string}`, kit: TransactionKit, client: GenLayerClient) {
  if (activeMonitors.has(id)) return;
  const task = monitor(id, kit, client).finally(() => activeMonitors.delete(id));
  activeMonitors.set(id, task);
}

function scheduleRateLimitedRetry(
  id: `0x${string}`,
  kit: TransactionKit,
  client: GenLayerClient,
  reason: unknown,
) {
  if (monitorRetryTimers.has(id)) return;
  const attempt = (monitorRetryCounts.get(id) ?? 0) + 1;
  if (attempt > MAX_RATE_LIMIT_RETRIES) return;
  monitorRetryCounts.set(id, attempt);
  const delay = Math.min(Math.max(rateLimitCooldownMs(reason), 5_000), 120_000);
  const timer = setTimeout(() => {
    monitorRetryTimers.delete(id);
    if (transactionListeners.has(id)) startMonitor(id, kit, client);
  }, delay);
  monitorRetryTimers.set(id, timer);
}

function pendingWrite(record: PendingTransaction) {
  return {
    kind: "write" as const,
    address: vetoContractAddress,
    method: record.method,
    args: record.args ?? [],
  };
}

export function watchPendingTransaction(
  record: PendingTransaction,
  kit: TransactionKit,
  client: GenLayerClient,
  listener: Listener,
) {
  const listeners = transactionListeners.get(record.id) ?? new Set<Listener>();
  listeners.add(listener);
  transactionListeners.set(record.id, listeners);
  startMonitor(record.id, kit, client);
  return () => {
    const current = transactionListeners.get(record.id);
    current?.delete(listener);
    if (current?.size === 0) {
      transactionListeners.delete(record.id);
      const retryTimer = monitorRetryTimers.get(record.id);
      if (retryTimer) clearTimeout(retryTimer);
      monitorRetryTimers.delete(record.id);
      monitorRetryCounts.delete(record.id);
    }
  };
}

export function usePendingTransactions() {
  const [records, setRecords] = useState(readPendingTransactions);
  useEffect(() => {
    const refresh = () => setRecords(readPendingTransactions());
    subscribers.add(refresh);
    return () => {
      subscribers.delete(refresh);
    };
  }, []);
  return records;
}

export function PendingTransactionMonitor() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const records = usePendingTransactions();
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const recordKey = records.map((record) => record.id).join("|");

  useEffect(() => {
    if (!wallet.kit || !wallet.connectedClient) return;
    const cleanups = recordsRef.current.map((record) =>
      watchPendingTransaction(record, wallet.kit!, wallet.connectedClient!, {
        onStatus: (status) => {
          if (
            status.phase === "decided" &&
            status.statusName === "ACCEPTED" &&
            status.successful === true &&
            status.executionResultName === "FINISHED_WITH_RETURN"
          )
            void invalidateVetoQueries(
              queryClient,
              invalidationKeysForWrite(pendingWrite(record), queryClient),
            );
        },
        onFinalized: () => {
          void invalidateVetoQueries(
            queryClient,
            invalidationKeysForWrite(pendingWrite(record), queryClient),
          );
        },
      }),
    );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [queryClient, recordKey, wallet.connectedClient, wallet.kit]);

  const first = records[0];
  if (!first) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-lg"
      role="status"
      data-testid="pending-transaction-indicator"
    >
      <strong className="text-foreground">GenLayer finality pending.</strong>{" "}
      {records.length === 1 ? "One transaction" : `${records.length} transactions`} continue in the
      background.{" "}
      <a
        className="text-link"
        href={explorerTransactionUrl(first.id)}
        target="_blank"
        rel="noreferrer"
      >
        View transaction
      </a>
    </div>
  );
}
