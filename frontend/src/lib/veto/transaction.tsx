import {
  CapsShield,
  FeeReceipt,
  HoldToSign,
  PresetSelector,
  Timeline,
  VerifyBadge,
  useTransactionFlow,
} from "@genlayer/transaction-kit-react";
import type {
  PolicyQuote,
  SubmitInput,
  TrackedStatus,
  TransactionKit,
} from "@genlayer/transaction-kit";
import { isSuccessful } from "genlayer-js";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatGen, isContractId } from "./domain";
import type { GenLayerClient } from "./client";
import type { ContractWrite } from "./contract";
import { normalizeVetoError } from "./errors";
import { explorerTransactionUrl } from "./network";
import {
  rememberPendingTransaction,
  watchPendingTransaction,
  type PendingTransaction,
} from "./pending";
import { VetoErrorNotice } from "@/components/veto/shared";

const transferMethods = new Set([
  "execute_proposal",
  "claim_reward",
  "claim_proposal_refund",
  "claim_campaign_remainder",
]);

export async function verifySuccessfulTransaction(status: TrackedStatus, client: GenLayerClient) {
  if (!status.genlayerTxId) throw new Error("Studio Next did not return a transaction ID.");
  if (status.successful === false)
    throw new Error(
      `Transaction execution failed: ${status.executionResultName ?? status.statusName ?? "unknown outcome"}.`,
    );
  const result = await client.getTransaction({ hash: status.genlayerTxId as never });
  if (status.phase !== "finalized" || !isSuccessful(result))
    throw new Error(
      `Transaction is not finalized successfully: ${result.txExecutionResultName ?? result.statusName ?? "unknown outcome"}.`,
    );
  return status.genlayerTxId;
}

export async function verifySuccessfulDecision(status: TrackedStatus, client: GenLayerClient) {
  if (!status.genlayerTxId) throw new Error("Studio Next did not return a transaction ID.");
  if (status.successful === false)
    throw new Error(
      `Transaction execution failed: ${status.executionResultName ?? status.statusName ?? "unknown outcome"}.`,
    );
  const result = await client.getTransaction({ hash: status.genlayerTxId as never });
  if (!isSuccessful(result) || result.statusName !== "ACCEPTED")
    throw new Error(
      `GenLayer did not confirm a successful accepted execution: ${result.txExecutionResultName ?? result.statusName ?? "unknown outcome"}.`,
    );
  return status.genlayerTxId;
}

/** Read the contract method's returned ID from a finalized transaction receipt. */
export function transactionResultId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = (value as { result?: unknown }).result;
  if (typeof result === "bigint" && result > 0n) return result.toString();
  if (typeof result === "number" && Number.isSafeInteger(result) && result > 0)
    return String(result);
  return isContractId(result) ? result : undefined;
}

function leaderRounds(distribution: PolicyQuote["distribution"]) {
  return distribution.rotations.reduce((total, rotations) => total + rotations + 1n, 1n);
}

function withTransferFees(baseKit: TransactionKit, client: GenLayerClient): TransactionKit {
  const isTransfer = (tx: SubmitInput | undefined): tx is Extract<SubmitInput, { kind: "write" }> =>
    tx?.kind === "write" && transferMethods.has(tx.method);
  return {
    ...(baseKit.allowUnverified ? { allowUnverified: true } : {}),
    estimate: async (input, tx) => {
      const baseQuote = await baseKit.estimate(input, tx);
      if (!isTransfer(tx)) return baseQuote;
      const distribution = baseQuote.distribution;
      const measured = await client.estimateTransactionFeesForWrite({
        address: tx.address,
        functionName: tx.method,
        ...(tx.args === undefined ? {} : { args: tx.args as never[] }),
        value: baseQuote.userValue,
        leaderTimeunitsAllocation: distribution.leaderTimeunitsAllocation,
        validatorTimeunitsAllocation: distribution.validatorTimeunitsAllocation,
        appealRounds: distribution.appealRounds,
        executionBudgetPerRound: distribution.executionBudgetPerRound,
        totalMessageFees: distribution.totalMessageFees,
        rotations: distribution.rotations,
        maxPriceGenPerTimeUnit: distribution.maxPriceGenPerTimeUnit,
        storageFeeMaxGasPrice: distribution.storageFeeMaxGasPrice,
        receiptFeeMaxGasPrice: distribution.receiptFeeMaxGasPrice,
      });
      if (!measured.messageAllocations?.length)
        throw new Error(`No external-message fee allocation was returned for ${tx.method}.`);
      const executionBudget =
        measured.distribution.executionBudgetPerRound * leaderRounds(measured.distribution);
      const messageFees = measured.distribution.totalMessageFees;
      return {
        ...baseQuote,
        distribution: measured.distribution,
        feeValue: measured.feeValue,
        total: measured.feeValue + baseQuote.userValue,
        breakdown: {
          timeUnitFees:
            measured.feeValue - messageFees - executionBudget > 0n
              ? measured.feeValue - messageFees - executionBudget
              : 0n,
          executionBudget,
          messageFees,
        },
        caps: {
          genPerTimeUnit: measured.distribution.maxPriceGenPerTimeUnit,
          storagePrice: measured.distribution.storageFeeMaxGasPrice,
          receiptPrice: measured.distribution.receiptFeeMaxGasPrice,
        },
        messageAllocations: measured.messageAllocations,
      } as PolicyQuote & { messageAllocations: unknown[] };
    },
    submit: async (quote, tx) => {
      if (!isTransfer(tx)) return baseKit.submit(quote, tx);
      const allocations = (quote as PolicyQuote & { messageAllocations?: unknown[] })
        .messageAllocations;
      if (!allocations?.length)
        throw new Error(`No external-message fee allocation is available for ${tx.method}.`);
      const result = await client.writeContract({
        address: tx.address,
        functionName: tx.method,
        ...(tx.args === undefined ? {} : { args: tx.args as never[] }),
        value: quote.userValue,
        fees: {
          distribution: quote.distribution,
          messageAllocations: allocations as never[],
          feeValue: quote.feeValue,
        },
      });
      return { genlayerTxId: result };
    },
    cancel: baseKit.cancel,
    topUp: baseKit.topUp,
    track: baseKit.track,
    verification: baseKit.verification,
  };
}

function TransactionViewport({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted
    ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="VETO transaction"
        >
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
          <div className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-[480px] overflow-y-auto sm:max-h-[calc(100dvh-3rem)]">
            {children}
          </div>
        </div>,
        document.body,
      )
    : null;
}

export function ExplorerLink({ txId }: { txId: string }) {
  return (
    <a className="text-link" href={explorerTransactionUrl(txId)} target="_blank" rel="noreferrer">
      View on Explorer
    </a>
  );
}

export function TransactionRunner({
  kit,
  client,
  write,
  onSuccess,
  onError,
  onDismiss,
  onAccepted,
  label = "Continue",
}: {
  kit: TransactionKit;
  client: GenLayerClient;
  write: ContractWrite;
  onSuccess: (txId: string) => void | Promise<void>;
  onError: (error: Error) => void;
  onDismiss?: () => void;
  onAccepted?: (txId: string, status: TrackedStatus) => void | Promise<void>;
  label?: string;
}) {
  const argsKey = write.args.map(String).join("|");
  const argsRef = useRef({ key: argsKey, args: write.args });
  if (argsRef.current.key !== argsKey) argsRef.current = { key: argsKey, args: write.args };
  const stableArgs = argsRef.current.args;
  const transactionKit = useMemo(() => withTransferFees(kit, client), [kit, client]);
  const flow = useTransactionFlow({
    kit: transactionKit,
    tx: useMemo(
      () => ({
        kind: "write" as const,
        address: write.address,
        method: write.method,
        args: stableArgs as never[],
      }),
      [write.address, write.method, stableArgs],
    ),
    trackUntil: "decided",
    ...(write.value === undefined ? {} : { userValue: write.value }),
  });
  const [verificationError, setVerificationError] =
    useState<ReturnType<typeof normalizeVetoError>>();
  const handled = useRef("");
  const persisted = useRef("");
  const finalizedHandled = useRef("");
  const [acceptedStatus, setAcceptedStatus] = useState<TrackedStatus>();
  const [backgroundStatus, setBackgroundStatus] = useState<TrackedStatus>();
  const [finalityError, setFinalityError] = useState<ReturnType<typeof normalizeVetoError>>();
  const state = flow.state;

  useEffect(() => {
    if (state.step !== "tracking" || !state.status.genlayerTxId) return;
    const id = state.status.genlayerTxId;
    if (persisted.current === id) return;
    persisted.current = id;
    rememberPendingTransaction(id, write.method, state.status);
  }, [state, write.method]);

  useEffect(() => {
    if (!acceptedStatus?.genlayerTxId) return;
    const id = acceptedStatus.genlayerTxId;
    const record: PendingTransaction = {
      id,
      method: write.method,
      submittedAt: Date.now(),
      phase: acceptedStatus.phase,
      ...(acceptedStatus.statusName ? { statusName: acceptedStatus.statusName } : {}),
      ...(acceptedStatus.executionResultName
        ? { executionResultName: acceptedStatus.executionResultName }
        : {}),
      ...(acceptedStatus.successful === undefined ? {} : { successful: acceptedStatus.successful }),
    };
    return watchPendingTransaction(record, transactionKit, client, {
      onStatus: (status) => {
        setBackgroundStatus(status);
        if (status.phase === "finalized") setFinalityError(undefined);
      },
      onFinalized: (status) => {
        if (finalizedHandled.current === id) return;
        finalizedHandled.current = id;
        setBackgroundStatus(status);
        void Promise.resolve(onSuccess(id)).catch((reason) =>
          setFinalityError(normalizeVetoError(reason)),
        );
      },
      onError: (reason) => setFinalityError(normalizeVetoError(reason)),
    });
  }, [acceptedStatus, client, onSuccess, transactionKit, write.method]);

  useEffect(() => {
    if (state.step === "error") {
      const error = normalizeVetoError(state.message);
      onError(error);
      onDismiss?.();
      return;
    }
    if (
      state.step !== "done" ||
      !state.status.genlayerTxId ||
      handled.current === state.status.genlayerTxId
    )
      return;
    handled.current = state.status.genlayerTxId;
    void verifySuccessfulDecision(state.status, client)
      .then(async (id) => {
        rememberPendingTransaction(id, write.method, state.status);
        setAcceptedStatus(state.status);
        setBackgroundStatus(state.status);
        await onAccepted?.(id, state.status);
      })
      .catch((reason) => {
        const error = normalizeVetoError(reason);
        setVerificationError(error);
        onError(error);
      });
  }, [client, onAccepted, onDismiss, onError, state, write.method]);
  const retry = () => {
    setVerificationError(undefined);
    handled.current = "";
    flow.reset();
  };
  const error =
    verificationError ?? (state.step === "error" ? normalizeVetoError(state.message) : undefined);
  const monitorStatus = backgroundStatus ?? acceptedStatus;
  const finalityInProgress = Boolean(
    monitorStatus?.phase === "processing" ||
    (monitorStatus?.statusName && !["ACCEPTED", "FINALIZED"].includes(monitorStatus.statusName)),
  );
  return (
    <TransactionViewport>
      <div className="gltk-root" data-theme="dark">
        <div className="gltk-panel">
          <div className="gltk-head">
            <span className="gltk-head-title">VETO TRANSACTION</span>
            <span className="gltk-head-network">Studio Next</span>
          </div>
          <div className="gltk-target">
            <span className="gltk-target-kind">Write</span>
            <span className="gltk-target-what">{write.method.replaceAll("_", " ")}</span>
          </div>
          <div className="gltk-receipt">
            <div className="gltk-row">
              <span className="gltk-row-label">Protocol value</span>
              <span className="gltk-row-value">
                {formatGen(write.value ?? 0n)} <span className="gltk-unit">GEN</span>
              </span>
            </div>
          </div>
          {state.step === "estimating" && (
            <div className="gltk-outcome" data-tone="warn">
              <p className="gltk-outcome-title">Preparing transaction</p>
              <p className="gltk-outcome-detail">Preparing the live Studio Next fee estimate…</p>
            </div>
          )}
          {(state.step === "review" || state.step === "blocked") && (
            <>
              <>
                {flow.quote && !flow.quote.gasless && (
                  <PresetSelector value={flow.preset} onChange={flow.setPreset} />
                )}
              </>
              {flow.quote && <FeeReceipt quote={flow.quote} />}
              {flow.quote && !flow.quote.gasless && <CapsShield quote={flow.quote} />}
              {flow.quote && <VerifyBadge status={flow.quote.verification.status} />}
              {state.step === "blocked" && (
                <div className="gltk-outcome" data-tone="error">
                  <p className="gltk-outcome-title">Review required</p>
                  <p className="gltk-outcome-detail">{normalizeVetoError(state.message).message}</p>
                </div>
              )}
              <div className="gltk-actions">
                {state.step === "blocked" ? (
                  <button type="button" onClick={retry}>
                    Re-estimate
                  </button>
                ) : (
                  <HoldToSign
                    onConfirm={() => void flow.approve()}
                    disabled={!flow.quote}
                    label="Approve & sign"
                  />
                )}
              </div>
              {onDismiss && (
                <div className="gltk-link-row">
                  <button type="button" onClick={onDismiss}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {state.step === "signing" && (
            <div className="gltk-outcome" data-tone="warn">
              <p className="gltk-outcome-title">Waiting for your wallet</p>
              <p className="gltk-outcome-detail">Approve the request in your wallet…</p>
            </div>
          )}
          {state.step === "tracking" && (
            <>
              <Timeline status={state.status} />
              {state.status.statusName === "ACCEPTED" && (
                <div className="gltk-outcome" data-tone="warn">
                  <p className="gltk-outcome-title">Accepted — awaiting finality</p>
                  <p className="gltk-outcome-detail">
                    Studio Next accepted the transaction, but VETO will refresh state only after
                    finalized successful execution.
                  </p>
                </div>
              )}
            </>
          )}
          {state.step === "done" && acceptedStatus && !error && (
            <>
              <Timeline status={monitorStatus ?? acceptedStatus} />
              <div className="gltk-outcome" data-tone={finalityError ? "error" : "warn"}>
                <p className="gltk-outcome-title">
                  {finalityError
                    ? "Finality needs attention"
                    : finalityInProgress
                      ? "Finality is still in progress"
                      : "Accepted — awaiting finality"}
                </p>
                <p className="gltk-outcome-detail">
                  {finalityError
                    ? finalityError.message
                    : finalityInProgress
                      ? `GenLayer is continuing consensus (${monitorStatus?.statusName ?? "processing"}). The accepted result remains provisional.`
                      : "Your transaction has been accepted by GenLayer. You can continue using VETO while finalization completes in the background."}
                </p>
              </div>
              <div className="gltk-link-row">
                <ExplorerLink txId={acceptedStatus.genlayerTxId ?? ""} />
                <a href="/dashboard" onClick={() => onDismiss?.()}>
                  Continue to dashboard
                </a>
                {onDismiss && (
                  <button type="button" onClick={onDismiss}>
                    Close modal
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This acceptance is provisional. GEN transfers and other financial effects are only
                confirmed after FINALIZED with successful execution.
              </p>
              {finalityError?.technicalMessage && (
                <details className="text-xs">
                  <summary>Technical details</summary>
                  <code className="mt-2 block break-words whitespace-pre-wrap">
                    {finalityError.technicalMessage}
                  </code>
                </details>
              )}
            </>
          )}
          {state.step === "done" && !acceptedStatus && !error && (
            <>
              <Timeline status={state.status} />
              <div className="gltk-outcome" data-tone="success">
                <p className="gltk-outcome-title">Transaction finalized</p>
                <p className="gltk-outcome-detail">
                  {label} is complete and the contract state can be refreshed.
                </p>
              </div>
              <ExplorerLink txId={state.status.genlayerTxId ?? ""} />
            </>
          )}
          {error && (
            <>
              <div className="gltk-outcome" data-tone="error">
                <p className="gltk-outcome-title">Transaction not completed</p>
                <VetoErrorNotice error={error} />
              </div>
              <div className="gltk-actions">
                <button type="button" onClick={retry}>
                  Retry
                </button>
                <button type="button" onClick={() => onDismiss?.()}>
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </TransactionViewport>
  );
}
