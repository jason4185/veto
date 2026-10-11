import { afterEach, describe, expect, it } from "vitest";
import { readKnownAgentId, rememberKnownAgentId } from "./agent-memory";

const wallet = "0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87";

describe("remembered agent navigation metadata", () => {
  afterEach(() => localStorage.clear());

  it("stores IDs per wallet and normalizes the wallet key", () => {
    expect(rememberKnownAgentId(wallet, " 1 ")).toBe(true);
    expect(readKnownAgentId(wallet.toLowerCase())).toBe("1");
  });

  it("rejects malformed IDs and never creates metadata for an invalid wallet", () => {
    expect(rememberKnownAgentId(wallet, "0")).toBe(false);
    expect(rememberKnownAgentId("not-an-address", "1")).toBe(false);
    expect(readKnownAgentId(wallet)).toBeUndefined();
  });

  it("remains only a navigation hint until a caller verifies get_agent on-chain", () => {
    expect(rememberKnownAgentId(wallet, "1")).toBe(true);
    expect(readKnownAgentId(wallet)).toBe("1");
    // This module deliberately exposes no owner, operator, eligibility, or reward fields.
    expect(JSON.parse(localStorage.getItem("veto:known-agent-ids:v1") ?? "{}")).toEqual({
      [wallet.toLowerCase()]: "1",
    });
  });
});
