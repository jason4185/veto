import { describe, it, expect, vi } from "vitest";
import {
  campaignLabel,
  agentControlsWallet,
  challengeEvaluationAvailable,
  chainConfig,
  formatDuration,
  formatGen,
  isContractId,
  normalizeContractId,
  parseGen,
  positiveGen,
  preflightEvidence,
  requiredCampaignFunding,
  resolutionStep,
  validateCampaignDuration,
  validateEvidence,
} from "./domain";
describe("exact GEN amounts", () => {
  it("converts fractional GEN to wei without floating point rounding", () => {
    expect(parseGen("10.000000000000000001")).toBe(10000000000000000001n);
  });
  it("retains all eighteen decimals", () => {
    expect(parseGen("1000000000000000000.000000000000000001")).toBe(
      1000000000000000000000000000000000001n,
    );
    expect(formatGen(1n)).toBe("0.000000000000000001");
  });
  it("rejects non-positive, excess precision and scientific notation", () => {
    for (const value of ["0", "-1", "1e3", "1.0000000000000000001"])
      expect(() => positiveGen(value)).toThrow();
  });
  it("has correct chain hex", () =>
    expect(Number.parseInt(chainConfig.chainHex, 16)).toBe(chainConfig.chainId));
});
describe("fixed-budget competition terms", () => {
  it("calculates the exact required funding without floating point", () => {
    expect(requiredCampaignFunding(10, parseGen("2"))).toBe(20000000000000000000n);
    expect(requiredCampaignFunding(10, parseGen("10.000000000000000001"))).toBe(
      100000000000000000010n,
    );
  });
  it("enforces the contract duration bounds", () => {
    validateCampaignDuration(3600);
    validateCampaignDuration(30 * 24 * 60 * 60);
    expect(() => validateCampaignDuration(3599)).toThrow();
    expect(() => validateCampaignDuration(30 * 24 * 60 * 60 + 1)).toThrow();
    expect(formatDuration(7 * 24 * 60 * 60)).toBe("7 days");
  });
  it("derives intake status from authoritative campaign fields", () => {
    const base = { status: "ACTIVE" as const, intakeOpen: true, remainingAgentSlots: 2 };
    expect(campaignLabel(base)).toBe("OPEN");
    expect(campaignLabel({ ...base, remainingAgentSlots: 0 })).toBe("CAP REACHED");
    expect(campaignLabel({ ...base, intakeOpen: false })).toBe("DEADLINE EXPIRED");
    expect(campaignLabel({ ...base, status: "CLOSED" })).toBe("CLOSED");
  });
});
describe("ordered challenge lifecycle", () => {
  const challenge = {
    id: "1",
    proposalId: "1",
    campaignId: "1",
    agentId: "1",
    allegation: "A violation.",
    explanation: "The facts support it.",
    evidenceUrl: "https://finding.netlify.app/evidence.json",
    submittedAt: 100,
    evaluationDeadline: 200,
    attempts: 0,
    status: "PENDING" as const,
    policyMatch: false,
    evidenceSufficient: false,
    policyIndex: 0,
    evidenceStatus: "NOT_EVALUATED",
    evidenceSha256: "",
    evaluatedAt: 0,
    accepted: false,
    rewardReserved: true,
  };
  const proposal = { stage: "PENDING" as const, challengeCount: 1, resolutionCursor: 0 };

  it("exposes immediate evaluation and blocks resolution while the first challenge is pending", () => {
    expect(challengeEvaluationAvailable(challenge, 150)).toBe(true);
    expect(resolutionStep(proposal, [challenge], true, 150)).toMatchObject({
      kind: "blocked",
      challenge,
    });
  });

  it("makes a valid cursor challenge resolvable and later challenges wait for priority", () => {
    const valid = { ...challenge, status: "VALID" as const, attempts: 1, evaluatedAt: 150 };
    expect(resolutionStep(proposal, [valid], true, 150)).toMatchObject({ kind: "challenge" });
    const later = { ...valid, id: "2", submittedAt: 101 };
    expect(
      resolutionStep({ ...proposal, challengeCount: 2 }, [challenge, later], true, 150),
    ).toMatchObject({ kind: "blocked", challenge });
  });

  it("permits clearing only after intake closes and all ordered challenges are terminal", () => {
    const invalid = { ...challenge, status: "INVALID" as const, attempts: 1, evaluatedAt: 150 };
    expect(resolutionStep(proposal, [invalid], true, 150)).toMatchObject({ kind: "challenge" });
    expect(resolutionStep({ ...proposal, resolutionCursor: 1 }, [invalid], true, 150)).toBeNull();
    expect(resolutionStep({ ...proposal, resolutionCursor: 1 }, [invalid], false, 150)).toEqual({
      kind: "clear",
    });
  });
});
describe("contract ID route normalization", () => {
  it("accepts positive integer route IDs and trims only surrounding whitespace", () => {
    expect(isContractId("1")).toBe(true);
    expect(isContractId("42")).toBe(true);
    expect(normalizeContractId(" 1 ")).toBe("1");
    expect(normalizeContractId(1)).toBe("1");
  });

  it("rejects missing, zero, negative, fractional and non-numeric IDs", () => {
    for (const value of [undefined, null, "", "0", "-1", "1.0", "agent-1", 0, 1.5]) {
      expect(normalizeContractId(value)).toBeUndefined();
    }
  });
});
describe("agent wallet authority", () => {
  const agent = {
    owner: "0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87",
    operator: "0x1111111111111111111111111111111111111111",
  };

  it("matches either live owner or operator and rejects disconnected or unrelated wallets", () => {
    expect(agentControlsWallet(agent, agent.owner)).toBe(true);
    expect(agentControlsWallet(agent, agent.operator)).toBe(true);
    expect(agentControlsWallet(agent)).toBe(false);
    expect(agentControlsWallet(agent, "0x2222222222222222222222222222222222222222")).toBe(false);
  });
});
describe("one Netlify evidence URL", () => {
  it("requires HTTPS and a Netlify hostname", () => {
    expect(validateEvidence("https://finding.netlify.app/evidence")).toBe(true);
    for (const value of [
      "http://finding.netlify.app",
      "https://netlify.app",
      "https://finding.netlify.app.evil.com",
      "https://user:pass@finding.netlify.app",
      "https://a.netlify.app https://b.netlify.app",
      "https://other.com",
    ])
      expect(validateEvidence(value)).toBe(false);
  });
  it("matches the contract restrictions for URL components and host labels", () => {
    for (const value of [
      "https://finding.netlify.app:443/path",
      "https://finding.netlify.app?query=1",
      "https://finding.netlify.app#fragment",
      "https://Finding.netlify.app",
      "https://a.b.netlify.app",
      "https://-finding.netlify.app",
      "https://finding-.netlify.app",
      "https://finding_netlify.app",
    ]) {
      expect(validateEvidence(value)).toBe(false);
    }
  });

  it("preflights matching VETO evidence without treating it as proof", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schema: "VETO-EVIDENCE-V1",
            campaign_id: 2,
            proposal_id: 7,
            policy_index: 1,
            violation: true,
            facts: "A bounded fact.",
            statement: "A publisher assertion, subject to GenLayer evaluation.",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await expect(
      preflightEvidence("https://finding.netlify.app/evidence.json", "2", "7", 1),
    ).resolves.toContain("GenLayer still decides");
    vi.unstubAllGlobals();
  });

  it("rejects evidence with mismatched immutable context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schema: "VETO-EVIDENCE-V1",
            campaign_id: 99,
            proposal_id: 7,
            policy_index: 1,
            violation: true,
            facts: "A fact.",
            statement: "A statement.",
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      preflightEvidence("https://finding.netlify.app/evidence.json", "2", "7", 1),
    ).rejects.toThrow("do not match");
    vi.unstubAllGlobals();
  });
});
