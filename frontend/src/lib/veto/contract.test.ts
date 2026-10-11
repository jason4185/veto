import { describe, expect, it, vi } from "vitest";
import {
  addProposalWrite,
  claimRewardWrite,
  createCampaignWrite,
  getCampaign,
  getCampaignProposals,
  getCampaigns,
  getConfig,
  getCreatorCampaigns,
  getAgent,
  getMyCampaigns,
  simpleWrite,
  submitChallengeWrite,
  discoverWalletAgent,
} from "./contract";
import { VetoReadError } from "./errors";
import { vetoContractAddress } from "./network";

describe("VETO contract write adapter", () => {
  it("uses the fixed-budget create_campaign signature and exact payable value", () => {
    const write = createCampaignWrite({
      name: "Treasury review",
      description: "Review spending proposals.",
      policies: ["Two approvals are required."],
      maxAgents: 10,
      reward: 2_000_000_000_000_000_000n,
      durationSeconds: 86_400,
    });

    expect(write).toEqual({
      kind: "write",
      address: vetoContractAddress,
      method: "create_campaign",
      args: [
        "Treasury review",
        "Review spending proposals.",
        "Two approvals are required.",
        10n,
        2_000_000_000_000_000_000n,
        86_400n,
      ],
      value: 20_000_000_000_000_000_000n,
    });
  });

  it("keeps proposal escrow separate and preserves exact challenge arguments", () => {
    const proposal = addProposalWrite(
      "4",
      "Payment review",
      "Review this payment.",
      "0x1111111111111111111111111111111111111111",
      3_000_000_000_000_000_001n,
      2,
    );
    const challenge = submitChallengeWrite(
      "8",
      "3",
      "Policy violation",
      "The evidence shows the required approval is absent.",
      "https://finding.netlify.app/evidence.json",
    );

    expect(proposal.method).toBe("add_proposal");
    expect(proposal.args).toEqual([
      4n,
      "Payment review",
      "Review this payment.",
      "0x1111111111111111111111111111111111111111",
      3_000_000_000_000_000_001n,
      2n,
    ]);
    expect(proposal.value).toBe(3_000_000_000_000_000_001n);
    expect(challenge.method).toBe("submit_challenge");
    expect(challenge.args).toEqual([
      8n,
      3n,
      "Policy violation",
      "The evidence shows the required approval is absent.",
      "https://finding.netlify.app/evidence.json",
    ]);
  });

  it("exposes only the final settlement methods and claim argument order", () => {
    expect(simpleWrite("evaluate_challenge", "7").args).toEqual([7n]);
    expect(simpleWrite("resolve_proposal", "8").args).toEqual([8n]);
    expect(simpleWrite("execute_proposal", "8").args).toEqual([8n]);
    expect(simpleWrite("claim_proposal_refund", "8").args).toEqual([8n]);
    expect(simpleWrite("close_campaign", "4").args).toEqual([4n]);
    expect(simpleWrite("claim_campaign_remainder", "4").args).toEqual([4n]);
    expect(claimRewardWrite("3", "4").args).toEqual([3n, 4n]);
  });
});

const creator = "0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87";
const campaign = {
  accepted_agents: 0,
  campaign_id: 1,
  can_close: false,
  challenge_count: 0,
  closed_at: 0,
  creator,
  created_at: 1,
  deadline: 2,
  description: "Treasury review.",
  duration_seconds: 86_400,
  intake_open: true,
  max_agents: 2,
  name: "Treasury Spending Limit Test",
  open_proposal_count: 1,
  participating_agents: 0,
  policy_count: 1,
  proposal_count: 1,
  remainder_claimed: false,
  remaining_agent_slots: 2,
  reward_available: "2000000000000000000",
  reward_claimable: 0,
  reward_funded: "2000000000000000000",
  reward_paid: 0,
  reward_per_accepted_agent: "1000000000000000000",
  reward_refunded: 0,
  reward_reserved: 0,
  status: "ACTIVE",
};
const policyPage = {
  has_more: false,
  items: [{ policy_index: 1, text: "Payments require review." }],
  limit: 1,
  offset: 0,
  total: 1,
};

describe("VETO creator campaign reads", () => {
  it("uses the connected client's sender scope for direct creator reads", async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "get_my_campaigns")
        return { has_more: false, items: [campaign], limit: 50, offset: 0, total: 1 };
      if (functionName === "get_campaign_policies") return policyPage;
      throw new Error(`Unexpected method ${functionName}`);
    });
    const client = {
      account: { address: creator },
      readContract,
    };

    const result = await getMyCampaigns(0, 50, client as never);

    expect(result.items[0]?.creator).toBe(creator);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "get_my_campaigns",
        args: [0n, 50n],
        transactionHashVariant: "latest-nonfinal",
      }),
    );
  });

  it("falls back to public campaign reads when sender-scoped discovery is empty", async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "get_my_campaigns") {
        return { has_more: false, items: [], limit: 50, offset: 0, total: 0 };
      }
      if (functionName === "get_campaign_count") return 1;
      if (functionName === "get_campaign") {
        return campaign;
      }
      if (functionName === "get_campaign_policies") return policyPage;
      throw new Error(`Unexpected method ${functionName}`);
    });

    const result = await getCreatorCampaigns(creator, 0, 50, { readContract } as never);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("1");
    expect(result.items[0]?.creator).toBe(creator);
    expect(result.items[0]?.policies).toEqual(["Payments require review."]);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "get_my_campaigns" }),
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "get_campaign" }),
    );
  });

  it("does not turn a failed sender read into an empty result", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("request timed out"));
    await expect(
      getCreatorCampaigns(creator, 0, 50, { readContract } as never),
    ).rejects.toBeInstanceOf(VetoReadError);
  });

  it("filters public fallback results by the contract creator address", async () => {
    const otherCreator = "0x1111111111111111111111111111111111111111";
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "get_my_campaigns")
        return { has_more: false, items: [], limit: 50, offset: 0, total: 0 };
      if (functionName === "get_campaign_count") return 2;
      if (functionName === "get_campaign")
        return { ...campaign, creator: otherCreator, campaign_id: 1 };
      if (functionName === "get_campaign_policies") return policyPage;
      throw new Error(`Unexpected method ${functionName}`);
    });

    const result = await getCreatorCampaigns(creator, 0, 50, { readContract } as never);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("VETO public read adapter", () => {
  it("reads and maps a public agent without requiring a wallet", async () => {
    const readContract = vi.fn().mockResolvedValue({
      agent_id: 1,
      active: true,
      challenge_count: 0,
      accepted_count: 0,
      claimable: 0,
      total_earned: 0,
      name: "VETO Audit Agent 01",
      description: "An on-chain governance auditor.",
      owner: creator,
      operator: creator,
      payout_address: creator,
    });

    const result = await getAgent("1", { readContract } as never);

    expect(result).toMatchObject({
      id: "1",
      name: "VETO Audit Agent 01",
      owner: creator,
      active: true,
      claimable: 0n,
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "get_agent",
        args: [1n],
        transactionHashVariant: "latest-nonfinal",
      }),
    );
  });

  it("verifies a remembered wallet agent without querying history", async () => {
    const request = vi.fn();
    const client = {
      request,
      readContract: vi.fn().mockResolvedValue({
        agent_id: 1,
        active: true,
        challenge_count: 0,
        accepted_count: 0,
        claimable: 0,
        total_earned: 0,
        name: "VETO Audit Agent 01",
        description: "An on-chain governance auditor.",
        owner: creator,
        operator: creator,
        payout_address: creator,
      }),
    };

    const result = await discoverWalletAgent(creator, "1", client as never);

    expect(result).toMatchObject({ source: "remembered", agent: { id: "1", owner: creator } });
    expect(request).not.toHaveBeenCalled();
  });

  it("discovers and verifies a previous registration from real transaction history", async () => {
    const hash = `0x${"1".repeat(64)}`;
    const client = {
      request: vi.fn().mockResolvedValue([
        {
          hash,
          from_address: creator,
          to_address: vetoContractAddress,
          status: "FINALIZED",
          data: { calldata: btoa("\u0016\u0000register_agent\u0004args") },
        },
      ]),
      getTransaction: vi.fn().mockResolvedValue({
        statusName: "FINALIZED",
        txExecutionResultName: "FINISHED_WITH_RETURN",
        result: 1,
      }),
      readContract: vi.fn().mockResolvedValue({
        agent_id: 1,
        active: true,
        challenge_count: 0,
        accepted_count: 0,
        claimable: 0,
        total_earned: 0,
        name: "VETO Audit Agent 01",
        description: "An on-chain governance auditor.",
        owner: creator,
        operator: creator,
        payout_address: creator,
      }),
    };

    const result = await discoverWalletAgent(creator, undefined, client as never);

    expect(result).toMatchObject({
      source: "registration-history",
      agent: { id: "1", name: "VETO Audit Agent 01" },
    });
    expect(client.getTransaction).toHaveBeenCalledWith({ hash });
  });

  it("does not accept a remembered ID when the live owner/operator is another wallet", async () => {
    const otherWallet = "0x1111111111111111111111111111111111111111";
    const client = {
      request: vi.fn().mockResolvedValue([]),
      readContract: vi.fn().mockResolvedValue({
        agent_id: 1,
        active: true,
        challenge_count: 0,
        accepted_count: 0,
        claimable: 0,
        total_earned: 0,
        name: "Someone else’s agent",
        description: "Not controlled by this wallet.",
        owner: otherWallet,
        operator: otherWallet,
        payout_address: otherWallet,
      }),
    };

    const result = await discoverWalletAgent(creator, "1", client as never);

    expect(result).toBeNull();
    expect(client.request).toHaveBeenCalledWith({
      method: "sim_getTransactionsForAddress",
      params: [creator],
    });
  });

  it("preserves an unknown-agent contract error as a read failure", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("[EXPECTED] unknown agent"));

    await expect(getAgent("999", { readContract } as never)).rejects.toMatchObject({
      name: "VetoReadError",
      context: { method: "get_agent", state: "latest-nonfinal" },
    });
  });

  it("uses latest-nonfinal and preserves proposal-to-campaign association", async () => {
    const readContract = vi.fn(async () => ({
      has_more: false,
      items: [
        {
          applicable_policy: "No single payment may exceed 5 GEN.",
          applicable_policy_index: 1,
          campaign_id: 1,
          challenge_count: 0,
          created_at: 1,
          description: "8 GEN payment.",
          escrow_state: "LOCKED",
          funder: creator,
          proposal_id: 1,
          recipient: "0x69885Aeb09f8cB62FFF8b2224C66791bFCaed317",
          resolution_cursor: 0,
          status: "OPEN",
          terminal_at: 0,
          title: "8 GEN Treasury Payment",
          winner_challenge_id: 0,
          payment_amount: "8000000000000000000",
        },
      ],
      limit: 50,
      offset: 0,
      total: 1,
    }));

    const result = await getCampaignProposals("1", 0, 50, { readContract } as never);

    expect(result.items[0]).toMatchObject({ id: "1", campaignId: "1", applicablePolicyIndex: 1 });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ transactionHashVariant: "latest-nonfinal", args: [1n, 0n, 50n] }),
    );
  });

  it("returns one campaign count read for a public campaign page", async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "get_campaign_count") return 1;
      if (functionName === "get_campaign") return campaign;
      if (functionName === "get_campaign_policies") return policyPage;
      throw new Error(`Unexpected method ${functionName}`);
    });

    const result = await getCampaigns(0, 50, { readContract } as never);

    expect(result.items).toHaveLength(1);
    expect(
      readContract.mock.calls.filter(([request]) => request.functionName === "get_campaign_count"),
    ).toHaveLength(1);
    expect(
      readContract.mock.calls.filter(
        ([request]) => request.functionName === "get_campaign_policies",
      ),
    ).toHaveLength(0);
  });

  it("surfaces structured RPC errors and rejects invalid IDs before a call", async () => {
    const timeoutClient = {
      readContract: vi.fn().mockRejectedValue(new Error("request timed out")),
    };
    await expect(getConfig(timeoutClient as never)).rejects.toMatchObject({
      name: "VetoReadError",
      context: { method: "get_config", state: "latest-nonfinal" },
    });

    const readContract = vi.fn();
    await expect(getCampaign("0", { readContract } as never)).rejects.toThrow(
      "Invalid campaign ID",
    );
    expect(readContract).not.toHaveBeenCalled();
  });
});
