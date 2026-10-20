import { afterEach, describe, expect, it } from "vitest";
import {
  forgetKnownAgentId,
  readKnownAgentId,
  rememberKnownAgentId,
  rememberKnownAgentIds,
  rememberVerifiedAgent,
} from "./agent-memory";

const wallet = "0xC8Ba5DA455b011863F2ECa76a6fa21E62Cc91B87";
const operator = "0x1111111111111111111111111111111111111111";
const payout = "0x2222222222222222222222222222222222222222";
const scope = { chainId: 61997, contractAddress: "0x302798B9e6C5603527E67A55fBdA47Ddea97E6F4" };
const otherScope = {
  chainId: 61997,
  contractAddress: "0xa0ede9BfE3C35455E18dDA2881D7dC801BD958c8",
};

describe("remembered agent navigation metadata", () => {
  afterEach(() => localStorage.clear());

  it("scopes IDs by chain, contract, and wallet", () => {
    expect(rememberKnownAgentId(wallet, " 1 ", scope)).toBe(true);
    expect(readKnownAgentId(wallet.toLowerCase(), scope)).toBe("1");
    expect(readKnownAgentId(wallet, otherScope)).toBeUndefined();
  });

  it("rejects malformed IDs and never creates metadata for an invalid wallet", () => {
    expect(rememberKnownAgentId(wallet, "0", scope)).toBe(false);
    expect(rememberKnownAgentId("not-an-address", "1", scope)).toBe(false);
    expect(readKnownAgentId(wallet, scope)).toBeUndefined();
  });

  it("stores a finalized registration for owner and operator, never payout", () => {
    expect(rememberVerifiedAgent({ owner: wallet, operator }, "7", scope)).toBe(true);
    expect(readKnownAgentId(wallet, scope)).toBe("7");
    expect(readKnownAgentId(operator, scope)).toBe("7");
    expect(readKnownAgentId(payout, scope)).toBeUndefined();
  });

  it("removes a replaced operator association and ignores stale legacy data", () => {
    expect(rememberKnownAgentId(operator, "7", scope)).toBe(true);
    expect(forgetKnownAgentId(operator, scope)).toBe(true);
    expect(readKnownAgentId(operator, scope)).toBeUndefined();
    localStorage.setItem(
      "veto:known-agent-ids:v1",
      JSON.stringify({ [operator.toLowerCase()]: "7" }),
    );
    expect(readKnownAgentId(operator, scope)).toBeUndefined();
  });

  it("does not cross wallet associations", () => {
    expect(rememberKnownAgentIds([wallet, operator], "9", scope)).toBe(true);
    expect(readKnownAgentId("0x3333333333333333333333333333333333333333", scope)).toBeUndefined();
  });
});
