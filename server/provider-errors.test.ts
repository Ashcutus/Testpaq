// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BILLING_URL, providerError } from "./provider-errors";

describe("OpenAI error classification", () => {
  it.each([
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_usage_limit_exceeded",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
  ])("explains %s and provides billing without exposing upstream content", (code) => {
    const detail = providerError({ status: 429, code, message: "secret-key-and-ticket" });
    expect(detail).toMatchObject({ code, billingUrl: BILLING_URL });
    expect(detail.message).toContain("billing");
    expect(detail.message).not.toContain("secret-key-and-ticket");
  });
  it("separates quota and rate limits", () => {
    expect(providerError({ status: 429, code: "rate_limit_exceeded" })).toMatchObject({ code: "rate_limited" });
    expect(providerError({ status: 429, type: "insufficient_quota" }).billingUrl).toBe(BILLING_URL);
    expect(providerError({ status: 401 })).toMatchObject({ code: "invalid_api_key" });
  });
});
