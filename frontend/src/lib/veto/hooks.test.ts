import { describe, expect, it } from "vitest";
import { shouldRetryVetoRead, vetoQueryKey } from "./hooks";

describe("VETO query identity and retry policy", () => {
  it("isolates sender-scoped campaign data by normalized wallet address", () => {
    const lower = vetoQueryKey("my-campaigns", "0xc8ba5da455b011863f2eca76a6fa21e62cc91b87", 0, 50);
    const otherWallet = vetoQueryKey(
      "my-campaigns",
      "0x1111111111111111111111111111111111111111",
      0,
      50,
    );

    expect(lower).not.toEqual(otherWallet);
    expect(lower[0]).toBe("veto");
    expect(lower[1]).toBe("my-campaigns");
  });

  it("retries transient RPC failures but not contract-state failures", () => {
    expect(shouldRetryVetoRead(0, new Error("request timed out"))).toBe(true);
    expect(shouldRetryVetoRead(1, new Error("failed to fetch"))).toBe(true);
    expect(shouldRetryVetoRead(0, new Error("Server busy: all execution slots occupied"))).toBe(
      true,
    );
    expect(shouldRetryVetoRead(0, new Error("Rate limit exceeded: 30 requests per minute"))).toBe(
      false,
    );
    expect(shouldRetryVetoRead(2, new Error("request timed out"))).toBe(false);
    expect(shouldRetryVetoRead(0, new Error("[EXPECTED] unknown campaign"))).toBe(false);
  });
});
