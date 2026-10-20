import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCampaignWrite } from "./contract";
import { TransactionRunner } from "./transaction";

type MockFlow = {
  state: { step: string; [key: string]: unknown };
  quote: unknown;
  preset: string;
  setPreset: () => void;
  approve: () => void;
  reset: () => void;
};

const mocks = vi.hoisted(() => ({
  flow: {
    state: { step: "review", status: {} },
    quote: undefined,
    preset: "standard",
    setPreset: vi.fn(),
    approve: vi.fn(),
    reset: vi.fn(),
  } as MockFlow,
  watchPendingTransaction: vi.fn(() => () => {}),
  rememberPendingTransaction: vi.fn(),
}));

vi.mock("@genlayer/transaction-kit-react", () => ({
  CapsShield: () => null,
  FeeReceipt: () => null,
  HoldToSign: () => null,
  PresetSelector: () => null,
  Timeline: () => null,
  VerifyBadge: () => null,
  useTransactionFlow: () => mocks.flow,
}));

vi.mock("./pending", () => ({
  watchPendingTransaction: mocks.watchPendingTransaction,
  rememberPendingTransaction: mocks.rememberPendingTransaction,
  pendingScope: () => ({
    chainId: 61997,
    contractAddress: "0x0000000000000000000000000000000000000001",
    sender: "0x1111111111111111111111111111111111111111",
  }),
}));

beforeEach(() => {
  mocks.flow.state = { step: "review", status: {} };
  mocks.flow.quote = undefined;
  mocks.watchPendingTransaction.mockClear();
  mocks.rememberPendingTransaction.mockClear();
});

describe("Transaction Kit viewport", () => {
  it("allows dismissal after a verified accepted decision", async () => {
    mocks.flow.state = {
      step: "done",
      preset: "standard",
      quote: {},
      status: {
        phase: "decided",
        genlayerTxId: "0x1234",
        statusName: "ACCEPTED",
        executionResultName: "FINISHED_WITH_RETURN",
        successful: true,
      },
    };
    const onDismiss = vi.fn();
    render(
      <TransactionRunner
        kit={{} as never}
        client={
          {
            getTransaction: vi.fn().mockResolvedValue({
              statusName: "ACCEPTED",
              txExecutionResultName: "FINISHED_WITH_RETURN",
            }),
          } as never
        }
        write={createCampaignWrite({
          name: "Two-agent review",
          description: "Review funded governance proposals.",
          policies: ["Payments require two approvals."],
          maxAgents: 2,
          reward: 1_000_000_000_000_000_000n,
          durationSeconds: 86_400,
        })}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "Your transaction has been accepted by GenLayer. You can continue using VETO while finalization completes in the background.",
        ),
      ).toBeVisible(),
    );
    screen.getByRole("button", { name: "Close modal" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("mounts a visible, accessible modal around the review flow", async () => {
    const write = createCampaignWrite({
      name: "Two-agent review",
      description: "Review funded governance proposals.",
      policies: ["Payments require two approvals."],
      maxAgents: 2,
      reward: 1_000_000_000_000_000_000n,
      durationSeconds: 86_400,
    });

    render(
      <TransactionRunner
        kit={{} as never}
        client={{} as never}
        write={write}
        onSuccess={vi.fn()}
        onError={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const modal = await waitFor(() => screen.getByRole("dialog", { name: "VETO transaction" }));
    expect(modal.className).toContain("fixed");
    expect(modal.className).toContain("z-[100]");
    expect(modal).toHaveTextContent("VETO TRANSACTION");
  });
});
