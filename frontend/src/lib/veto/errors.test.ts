import { describe, expect, it } from "vitest";
import { normalizeVetoError } from "./errors";

describe("VETO error normalization", () => {
  it("maps contract state errors to an actionable message and preserves details", () => {
    const error = normalizeVetoError(new Error("[EXPECTED] agent already entered campaign"));
    expect(error.message).toContain("one submission per campaign");
    expect(error.nextAction).toContain("existing challenge");
    expect(error.technicalMessage).toContain("agent already entered campaign");
  });

  it("distinguishes wallet rejection from unknown failures", () => {
    expect(normalizeVetoError({ code: 4001, message: "User rejected" }).kind).toBe(
      "wallet_rejected",
    );
    expect(normalizeVetoError("unexpected provider response").kind).toBe("unknown");
  });

  it("does not turn accepted or unavailable outcomes into success", () => {
    const error = normalizeVetoError(new Error("execution reverted: no claimable reward"));
    expect(error.message).toContain("no rewards available");
    expect(error.message.toLowerCase()).not.toContain("success");
  });
});
