import { describe, expect, it, vi } from "vitest";
import type { TrackedStatus } from "@genlayer/transaction-kit";
import {
  transactionResultId,
  transactionFailureDetail,
  verifySuccessfulDecision,
  verifySuccessfulTransaction,
} from "./transaction";
import { getVetoTransaction } from "./client";

const finalized = {
  statusName: "FINALIZED",
  txExecutionResultName: "FINISHED_WITH_RETURN",
};

function status(overrides: Partial<TrackedStatus>): TrackedStatus {
  return {
    phase: "finalized",
    genlayerTxId: "0x1234" as `0x${string}`,
    ...overrides,
  };
}

describe("finalized transaction verification", () => {
  it("preserves an explicit protocol contract error for user-facing decoding", () => {
    expect(
      transactionFailureDetail({
        consensus_data: {
          leader_receipt: [
            {
              result: { status: "contract_error", payload: "[EXPECTED] operator already used" },
            },
          ],
        },
      }),
    ).toBe("[EXPECTED] operator already used");
    expect(transactionFailureDetail({ result: "[EXPECTED] owner already used" })).toBe(
      "[EXPECTED] owner already used",
    );
    expect(transactionFailureDetail({ statusName: "FINALIZED" })).toBeUndefined();
  });

  it("reads the returned contract ID from the GenLayer leader payload", () => {
    expect(
      transactionResultId({
        result: 1,
        consensus_data: {
          leader_receipt: [{ result: { status: "return", payload: { readable: "2" } } }],
        },
      }),
    ).toBe("2");
    expect(transactionResultId({ result: 1 })).toBeUndefined();
    expect(
      transactionResultId({
        result: 1,
        consensus_data: {
          leader_receipt: [{ result: { status: "contract_error", payload: "unknown agent" } }],
        },
      }),
    ).toBeUndefined();
    expect(transactionResultId({})).toBeUndefined();
  });

  it("accepts an accepted successful execution as provisional", async () => {
    const client = { getTransaction: vi.fn() };
    await expect(
      verifySuccessfulDecision(
        status({
          phase: "decided",
          statusName: "ACCEPTED",
          executionResultName: "FINISHED_WITH_RETURN",
          successful: true,
        }),
        {
          getTransaction: vi.fn().mockResolvedValue({
            statusName: "ACCEPTED",
            txExecutionResultName: "FINISHED_WITH_RETURN",
          }),
        } as never,
      ),
    ).resolves.toBe("0x1234");
  });

  it("does not treat an accepted contract error as provisional success", async () => {
    await expect(
      verifySuccessfulDecision(
        status({
          phase: "decided",
          statusName: "ACCEPTED",
          executionResultName: "FINISHED_WITH_ERROR",
          successful: false,
        }),
        { getTransaction: vi.fn() } as never,
      ),
    ).rejects.toThrow("Transaction execution failed");
  });

  it("uses an explicit finalized receipt error when the status includes a transaction ID", async () => {
    await expect(
      verifySuccessfulDecision(
        status({
          phase: "decided",
          statusName: "ACCEPTED",
          executionResultName: "FINISHED_WITH_ERROR",
          successful: false,
        }),
        {
          getTransaction: vi.fn().mockResolvedValue({
            consensus_data: {
              leader_receipt: [
                {
                  result: {
                    status: "contract_error",
                    payload: "[EXPECTED] operator already used",
                  },
                },
              ],
            },
          }),
        } as never,
      ),
    ).rejects.toThrow("operator already used");
  });

  it("does not treat an accepted transaction as finalized", async () => {
    const client = {
      getTransaction: vi.fn().mockResolvedValue({
        statusName: "ACCEPTED",
        txExecutionResultName: "FINISHED_WITH_RETURN",
      }),
    };
    await expect(
      verifySuccessfulTransaction(status({ phase: "decided", successful: true }), client as never),
    ).rejects.toThrow("not finalized successfully");
  });

  it("rechecks and accepts a finalized successful receipt", async () => {
    const client = { getTransaction: vi.fn().mockResolvedValue(finalized) };
    await expect(
      verifySuccessfulTransaction(status({ phase: "finalized" }), client as never),
    ).resolves.toBe("0x1234");
    expect(client.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a finalized execution error", async () => {
    const client = {
      getTransaction: vi.fn().mockResolvedValue({
        statusName: "FINALIZED",
        txExecutionResultName: "ERROR",
      }),
    };
    await expect(verifySuccessfulTransaction(status({}), client as never)).rejects.toThrow(
      "not finalized successfully",
    );
  });

  it("reuses a finalized receipt for post-finality verification", async () => {
    const client = { getTransaction: vi.fn().mockResolvedValue(finalized) };
    await getVetoTransaction(client as never, "0xcached-receipt");
    await getVetoTransaction(client as never, "0xcached-receipt");
    expect(client.getTransaction).toHaveBeenCalledTimes(1);
  });
});
