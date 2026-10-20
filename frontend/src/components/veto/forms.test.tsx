import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractWrite } from "@/lib/veto/contract";
import { readKnownAgentId, rememberKnownAgentId } from "@/lib/veto/agent-memory";
import { rememberPendingTransaction } from "@/lib/veto/pending";
import { ChallengeForm, CreatorForm, FundedProposalForm, UpdateAgentForm } from "./forms";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  useNavigate: () => mocks.navigate,
}));

const mocks = vi.hoisted(() => ({
  wallet: {
    address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
    chainId: 61997,
    status: "connected" as "connected" | "disconnected" | "wrong-network",
    busy: false,
    kit: {} as object,
    connectedClient: {} as object,
    connect: vi.fn<() => Promise<void>>(),
    switchToStudioNext: vi.fn<() => Promise<void>>(),
    switchChain: vi.fn<() => Promise<void>>(),
    disconnect: vi.fn<() => Promise<boolean>>(),
  },
  navigate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  getAgent: vi.fn(),
  getAgentByWallet: vi.fn(),
  getAgentCampaignParticipation: vi.fn(),
  lastWrite: undefined as ContractWrite | undefined,
  invalidateVetoQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  proposal: undefined as unknown,
  campaign: undefined as unknown,
  participation: undefined as unknown,
}));

vi.mock("@/lib/veto/contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/veto/contract")>();
  return {
    ...actual,
    getAgent: mocks.getAgent,
    getAgentByWallet: mocks.getAgentByWallet,
    getAgentCampaignParticipation: mocks.getAgentCampaignParticipation,
  };
});

vi.mock("@/lib/veto/wallet", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("@/lib/veto/hooks", () => ({
  invalidateVetoQueries: mocks.invalidateVetoQueries,
  invalidationKeysForWrite: () => [],
  walletAgentQueryKey: (address?: string, chainId?: number) => [
    "veto",
    "wallet-agent",
    address?.toLowerCase() ?? "disconnected",
    chainId ?? "unknown",
  ],
  useVetoConfig: () => ({
    data: {
      protocol: "VETO V1",
      minDuration: 3_600,
      maxDuration: 2_592_000,
      maxAgents: 1_000,
      evaluationGrace: 86_400,
    },
  }),
  useAgent: () => ({ data: undefined }),
  useCampaign: () => ({ data: mocks.campaign }),
  useChallenge: () => ({ data: undefined }),
  useMyCampaigns: () => ({
    data: {
      items: [
        {
          id: "1",
          creator: "0x1111111111111111111111111111111111111111",
          name: "Treasury Spending Limit Test",
          description: "Treasury review.",
          policyCount: 1,
          policies: ["Payments require review."],
          maxAgents: 2,
          participatingAgents: 0,
          remainingAgentSlots: 2,
          acceptedAgents: 0,
          rewardPerAcceptedAgent: 1_000_000_000_000_000_000n,
          durationSeconds: 86_400,
          createdAt: 1,
          deadline: 2,
          closedAt: 0,
          status: "ACTIVE",
          intakeOpen: true,
          canClose: false,
          proposalCount: 0,
          openProposalCount: 0,
          challengeCount: 0,
          rewardFunded: 2_000_000_000_000_000_000n,
          rewardReserved: 0n,
          rewardClaimable: 0n,
          rewardPaid: 0n,
          rewardRefunded: 0n,
          rewardAvailable: 2_000_000_000_000_000_000n,
          remainderClaimed: false,
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    },
    isPending: false,
    isError: false,
  }),
  useParticipation: () => ({ data: mocks.participation }),
  useProposal: () => ({ data: mocks.proposal }),
  useWalletAgent: () => ({
    data: {
      source: "remembered",
      agent: {
        id: "1",
        name: "VETO Audit Agent 01",
        description: "Verified on-chain.",
        owner: "0x1111111111111111111111111111111111111111",
        operator: "0x1111111111111111111111111111111111111111",
        payoutAddress: "0x1111111111111111111111111111111111111111",
        active: true,
        challengeCount: 0,
        acceptedCount: 0,
        claimable: 0n,
        totalEarned: 0n,
      },
    },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/veto/transaction", () => ({
  transactionResultId: (value: { result?: number | string }) => {
    const result = value.result;
    return typeof result === "number" && result > 0
      ? String(result)
      : typeof result === "string" && /^[1-9]\d*$/.test(result)
        ? result
        : undefined;
  },
  TransactionRunner: ({
    write,
    onSuccess,
  }: {
    write: ContractWrite;
    onSuccess?: (txId: string) => void | Promise<void>;
  }) => {
    mocks.lastWrite = write;
    return (
      <div role="dialog" aria-label="VETO transaction">
        Transaction Kit review · {write.method} · {String(write.value)} wei
        {onSuccess && (
          <button type="button" onClick={() => void onSuccess("0xregistration")}>
            Finalize transaction
          </button>
        )}
      </div>
    );
  },
}));

function renderCreator() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CreatorForm />
    </QueryClientProvider>,
  );
}

function renderFundedProposal() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <FundedProposalForm />
    </QueryClientProvider>,
  );
}

function prepareReview() {
  fireEvent.change(screen.getByLabelText("Campaign name"), {
    target: { value: "Two-agent review" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Review funded governance proposals." },
  });
  fireEvent.change(screen.getByLabelText("Policy lines"), {
    target: { value: "Payments require two approvals." },
  });
  fireEvent.change(screen.getByLabelText("Maximum participating agents"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Reward per accepted winner"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review fixed budget" }));
  fireEvent.click(screen.getByRole("checkbox"));
}

afterEach(() => {
  localStorage.clear();
  mocks.wallet.status = "connected";
  mocks.wallet.chainId = 61997;
  mocks.wallet.busy = false;
  mocks.wallet.connect.mockReset();
  mocks.wallet.switchToStudioNext.mockReset();
  mocks.wallet.kit = {};
  mocks.wallet.connectedClient = {};
  mocks.navigate.mockReset();
  mocks.navigate.mockResolvedValue(undefined);
  mocks.getAgent.mockReset();
  mocks.getAgentByWallet.mockReset();
  mocks.getAgentCampaignParticipation.mockReset();
  mocks.lastWrite = undefined;
  mocks.invalidateVetoQueries.mockReset();
  mocks.invalidateVetoQueries.mockResolvedValue(undefined);
  mocks.proposal = undefined;
  mocks.campaign = undefined;
  mocks.participation = undefined;
  vi.clearAllMocks();
});

describe("CreatorForm funding action", () => {
  it("opens the Transaction Kit review with the exact 2 GEN payable value", async () => {
    renderCreator();
    prepareReview();

    expect(screen.getByText("Total required funding").nextElementSibling).toHaveTextContent(
      "2 GEN",
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm & fund campaign" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "VETO transaction" })).toBeVisible(),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("2000000000000000000 wei");
  });

  it("keeps the funding button actionable and requests a disconnected wallet", async () => {
    mocks.wallet.status = "disconnected";
    mocks.wallet.kit = undefined as never;
    mocks.wallet.connectedClient = undefined as never;
    renderCreator();
    prepareReview();

    const button = screen.getByRole("button", { name: "Connect wallet to fund" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.wallet.connect).toHaveBeenCalledTimes(1));
  });

  it("requests a Studio Next switch instead of silently doing nothing on the wrong network", async () => {
    mocks.wallet.status = "wrong-network";
    mocks.wallet.chainId = 1;
    renderCreator();
    prepareReview();

    fireEvent.click(screen.getByRole("button", { name: "Switch to Studio Next" }));

    await waitFor(() => expect(mocks.wallet.switchToStudioNext).toHaveBeenCalledTimes(1));
  });

  it("blocks duplicate funding clicks while a review is open", async () => {
    renderCreator();
    prepareReview();

    const button = screen.getByRole("button", { name: "Confirm & fund campaign" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(button).toBeDisabled();
  });

  it("blocks a second campaign funding attempt while a previous transaction is pending", () => {
    rememberPendingTransaction("0x9999", "create_campaign", {
      phase: "decided",
      genlayerTxId: "0x9999",
      statusName: "ACCEPTED",
      executionResultName: "FINISHED_WITH_RETURN",
      successful: true,
    });
    renderCreator();
    prepareReview();

    const button = screen.getByRole("button", { name: "Campaign funding pending" });
    expect(button).toBeDisabled();
  });
});

describe("FundedProposalForm campaign discovery", () => {
  it("shows the connected creator's on-chain campaign in the dropdown", () => {
    renderFundedProposal();

    const select = screen.getByRole("combobox", { name: "Owned campaign" });
    expect(select).not.toBeDisabled();
    expect(screen.getByRole("option", { name: /Treasury Spending Limit Test.*#1/i })).toBeVisible();
  });
});

describe("ChallengeForm automatic agent selection", () => {
  it("shows the verified wallet agent without requiring an ID input", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChallengeForm proposalId="1" />
      </QueryClientProvider>,
    );

    expect(screen.getByText("VETO Audit Agent 01")).toBeVisible();
    expect(screen.getByText("Agent #1 · active")).toBeVisible();
    expect(screen.queryByLabelText("Registered agent ID")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another agent ID" })).toBeVisible();
  });

  it("navigates to the verified finding after finalized submission", async () => {
    mocks.proposal = {
      id: "1",
      campaignId: "1",
      title: "8 GEN Treasury Payment",
      description: "Payment review.",
      recipient: "0x2222222222222222222222222222222222222222",
      funder: mocks.wallet.address,
      paymentAmount: 8_000_000_000_000_000_000n,
      applicablePolicyIndex: 1,
      applicablePolicy: "Payments must not exceed 5 GEN.",
      createdAt: 1,
      stage: "OPEN",
      challengeCount: 0,
      resolutionCursor: 0,
      winnerChallengeId: null,
      escrowState: "LOCKED",
      terminalAt: 0,
    };
    mocks.campaign = {
      id: "1",
      name: "Treasury Spending Limit Test",
      description: "Treasury review.",
      creator: mocks.wallet.address,
      policyCount: 1,
      policies: ["Payments must not exceed 5 GEN."],
      maxAgents: 2,
      participatingAgents: 0,
      remainingAgentSlots: 2,
      acceptedAgents: 0,
      rewardPerAcceptedAgent: 1_000_000_000_000_000_000n,
      durationSeconds: 86_400,
      createdAt: 1,
      deadline: 2_000_000_000,
      closedAt: 0,
      status: "ACTIVE",
      intakeOpen: true,
      canClose: false,
      proposalCount: 1,
      openProposalCount: 1,
      challengeCount: 0,
      rewardFunded: 2_000_000_000_000_000_000n,
      rewardReserved: 0n,
      rewardClaimable: 0n,
      rewardPaid: 0n,
      rewardRefunded: 0n,
      rewardAvailable: 2_000_000_000_000_000_000n,
      remainderClaimed: false,
    };
    mocks.getAgentCampaignParticipation.mockResolvedValue({
      participated: true,
      challengeId: "9",
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChallengeForm proposalId="1" />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Allegation"), {
      target: { value: "The payment exceeds the policy limit." },
    });
    fireEvent.change(screen.getByLabelText("Explanation"), {
      target: { value: "The proposal amount is greater than the governing limit." },
    });
    fireEvent.change(screen.getByLabelText("Netlify evidence URL"), {
      target: { value: "https://finding.netlify.app/evidence.json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review evidence" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Submit challenge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalize transaction" }));

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/finding/$id",
        params: { id: "9" },
      }),
    );
  });
});

describe("RegisterAgentForm finalized navigation", () => {
  it("verifies the returned agent ID before navigating to its profile", async () => {
    const connectedClient = {
      getTransaction: vi.fn().mockResolvedValue({ result: 1 }),
    };
    mocks.wallet.connectedClient = connectedClient;
    mocks.getAgentByWallet.mockResolvedValue("1");
    mocks.getAgent.mockResolvedValue({
      id: "1",
      name: "Verified agent",
      description: "Verified on-chain.",
      owner: mocks.wallet.address,
      operator: "0x2222222222222222222222222222222222222222",
      payoutAddress: mocks.wallet.address,
      active: true,
      challengeCount: 0,
      acceptedCount: 0,
      claimable: 0n,
      totalEarned: 0n,
    });

    const { RegisterAgentForm } = await import("./forms");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RegisterAgentForm />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Verified agent" },
    });
    fireEvent.change(screen.getByLabelText("Agent description"), {
      target: { value: "Verified on-chain." },
    });
    fireEvent.change(screen.getByLabelText("Operator address"), {
      target: { value: "0x2222222222222222222222222222222222222222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review registration" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Register agent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalize transaction" }));

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/agent/$id",
        params: { id: "1" },
      }),
    );
    expect(connectedClient.getTransaction).toHaveBeenCalledWith({ hash: "0xregistration" });
    expect(mocks.lastWrite).toMatchObject({
      method: "register_agent",
      args: [
        "Verified agent",
        "Verified on-chain.",
        "0x2222222222222222222222222222222222222222",
        mocks.wallet.address,
      ],
    });
    expect(mocks.getAgentByWallet).toHaveBeenCalledWith(mocks.wallet.address, connectedClient);
    expect(mocks.getAgent).toHaveBeenCalledWith("1", connectedClient);
    expect(readKnownAgentId(mocks.wallet.address)).toBe("1");
    expect(readKnownAgentId("0x2222222222222222222222222222222222222222")).toBe("1");
  });
});

describe("UpdateAgentForm operator association", () => {
  it("forgets a replaced operator only after the update is finalized and verified", async () => {
    const oldOperator = "0x2222222222222222222222222222222222222222";
    const newOperator = "0x3333333333333333333333333333333333333333";
    const agent = {
      id: "1",
      name: "Verified agent",
      description: "Verified on-chain.",
      owner: mocks.wallet.address,
      operator: oldOperator,
      payoutAddress: mocks.wallet.address,
      active: true,
    };
    const updatedAgent = {
      ...agent,
      operator: newOperator,
      challengeCount: 0,
      acceptedCount: 0,
      claimable: 0n,
      totalEarned: 0n,
    };
    const connectedClient = {};
    mocks.wallet.connectedClient = connectedClient;
    expect(rememberKnownAgentId(oldOperator, "1")).toBe(true);
    mocks.getAgent.mockResolvedValue(updatedAgent);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <UpdateAgentForm agent={agent} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Updated operator address"), {
      target: { value: newOperator },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review profile update" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finalize transaction" }));

    await waitFor(() => expect(readKnownAgentId(newOperator)).toBe("1"));
    expect(readKnownAgentId(oldOperator)).toBeUndefined();
  });
});
