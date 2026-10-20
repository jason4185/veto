import type { TrackedStatus, TransactionKit } from "@genlayer/transaction-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readPendingTransactions,
  rememberPendingTransaction,
  filterPendingTransactions,
  pendingScope,
  watchPendingTransaction,
} from "./pending";

const id = "0x1234" as `0x${string}`;

function status(overrides: Partial<TrackedStatus>): TrackedStatus {
  return { phase: "submitted", genlayerTxId: id, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
});

describe("background transaction finality monitoring", () => {
  it("ignores legacy unscoped pending metadata after the storage schema change", () => {
    localStorage.setItem(
      "veto.pending-transactions.v1",
      JSON.stringify([{ id: "0xdead", method: "register_agent", submittedAt: Date.now() }]),
    );
    expect(readPendingTransactions()).toEqual([]);
  });

  it("does not surface another deployment or wallet's pending transaction", () => {
    const otherWallet = "0x2222222222222222222222222222222222222222";
    const currentWallet = "0x1111111111111111111111111111111111111111";
    rememberPendingTransaction(
      "0xaaaa",
      "register_agent",
      status({}),
      [],
      pendingScope(otherWallet),
    );
    rememberPendingTransaction("0xbbbb", "create_campaign", status({}), [], {
      chainId: 61997,
      contractAddress: "0x0000000000000000000000000000000000000002",
      sender: currentWallet,
    });
    expect(
      filterPendingTransactions(readPendingTransactions(), pendingScope(currentWallet)),
    ).toEqual([]);
    expect(
      filterPendingTransactions(readPendingTransactions(), pendingScope(otherWallet)),
    ).toHaveLength(1);
  });

  it("continues through appeal/recomputation and removes only finalized success", async () => {
    const updates: TrackedStatus[] = [];
    const final = status({
      phase: "finalized",
      statusName: "FINALIZED",
      executionResultName: "FINISHED_WITH_RETURN",
    });
    rememberPendingTransaction(
      id,
      "create_campaign",
      status({ phase: "decided", statusName: "ACCEPTED" }),
    );
    const onFinalized = vi.fn();
    const kit = {
      track: vi.fn(async (_txId, onUpdate) => {
        onUpdate(status({ phase: "processing", statusName: "APPEAL_REVEALING" }));
        onUpdate(final);
        return final;
      }),
    } as unknown as TransactionKit;

    watchPendingTransaction(
      readPendingTransactions()[0]!,
      kit,
      {
        getTransaction: vi.fn().mockResolvedValue({
          statusName: "FINALIZED",
          txExecutionResultName: "FINISHED_WITH_RETURN",
        }),
      } as never,
      {
        onStatus: (next) => updates.push(next),
        onFinalized,
      },
    );

    await vi.waitFor(() => expect(onFinalized).toHaveBeenCalledTimes(1));
    expect(updates.some((next) => next.statusName === "APPEAL_REVEALING")).toBe(true);
    expect(readPendingTransactions()).toHaveLength(0);
  });

  it("keeps metadata and reports an RPC timeout for later resumption", async () => {
    const onError = vi.fn();
    rememberPendingTransaction(id, "claim_reward", status({ phase: "submitted" }));
    const kit = {
      track: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    } as unknown as TransactionKit;

    watchPendingTransaction(
      readPendingTransactions()[0]!,
      kit,
      { getTransaction: vi.fn() } as never,
      { onError },
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(readPendingTransactions()).toHaveLength(1);
  });

  it("removes a finalized execution error without reporting success", async () => {
    const finalError = status({
      phase: "finalized",
      statusName: "FINALIZED",
      executionResultName: "FINISHED_WITH_ERROR",
    });
    const onFinalized = vi.fn();
    const onError = vi.fn();
    rememberPendingTransaction(id, "claim_proposal_refund", status({ phase: "decided" }));
    const kit = {
      track: vi.fn(async (_txId, onUpdate) => {
        onUpdate(finalError);
        return finalError;
      }),
    } as unknown as TransactionKit;

    watchPendingTransaction(
      readPendingTransactions()[0]!,
      kit,
      { getTransaction: vi.fn().mockResolvedValue(finalError) } as never,
      { onFinalized, onError },
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(onFinalized).not.toHaveBeenCalled();
    expect(readPendingTransactions()).toHaveLength(0);
  });
});
