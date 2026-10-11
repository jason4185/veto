import { describe, expect, it, vi } from "vitest";
import type { TrackedStatus } from "@genlayer/transaction-kit";
import {
  transactionResultId,
  verifySuccessfulDecision,
  verifySuccessfulTransaction,
} from "./transaction";

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
  it("accepts only a positive returned contract ID", () => {
    expect(transactionResultId({ result: 1 })).toBe("1");
    expect(transactionResultId({ result: "2" })).toBe("2");
    expect(transactionResultId({ result: 0 })).toBeUndefined();
    expect(transactionResultId({ result: "not-an-id" })).toBeUndefined();
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
});
