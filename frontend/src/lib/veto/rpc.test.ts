import { describe, expect, it, vi } from "vitest";
import {
  getRpcCooldownRemainingMs,
  rateLimitCooldownMs,
  resetVetoRpcDiagnostics,
  runRpcRequest,
} from "./rpc";

describe("shared VETO RPC request manager", () => {
  it("deduplicates concurrent requests with the same read identity", async () => {
    resetVetoRpcDiagnostics();
    const request = vi.fn(async () => ({ ok: true }));

    const [first, second] = await Promise.all([
      runRpcRequest({ key: "campaign:1", method: "get_campaign", request }),
      runRpcRequest({ key: "campaign:1", method: "get_campaign", request }),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("opens a shared bounded cooldown after a rate-limit response", async () => {
    resetVetoRpcDiagnostics();
    const request = vi
      .fn()
      .mockRejectedValue(new Error("Rate limit exceeded: 30 requests per minute"));

    await expect(
      runRpcRequest({ key: "campaign-count", method: "get_campaign_count", request }),
    ).rejects.toThrow("30 requests per minute");
    await expect(
      runRpcRequest({ key: "campaign-1", method: "get_campaign", request }),
    ).rejects.toMatchObject({ name: "VetoRpcRateLimitError" });

    expect(request).toHaveBeenCalledTimes(1);
    expect(getRpcCooldownRemainingMs()).toBeGreaterThan(0);
    resetVetoRpcDiagnostics();
  });

  it("honors a server Retry-After value while clamping unsafe values", () => {
    expect(
      rateLimitCooldownMs({ response: { headers: new Headers({ "retry-after": "2" }) } }),
    ).toBe(2_000);
    expect(
      rateLimitCooldownMs({ response: { headers: new Headers({ "retry-after": "9999" }) } }),
    ).toBe(120_000);
  });
});
