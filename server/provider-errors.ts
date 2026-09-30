import { z } from "zod";

export const BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";
const billingCodes = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "billing_hard_limit_reached",
  "billing_not_active",
  "organization_usage_limit_exceeded",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
]);
export function providerError(error: unknown) {
  const value = error as { status?: number; code?: string; type?: string; name?: string } | null;
  if (billingCodes.has(value?.code || "") || value?.type === "insufficient_quota" || value?.status === 402) {
    return {
      code: value?.code || "insufficient_quota",
      message:
        "OpenAI blocked this request because credits are exhausted or a billing/usage limit was reached. Check your API billing, add credits or adjust limits, then retry. ChatGPT subscriptions do not include API credit.",
      billingUrl: BILLING_URL,
    };
  }
  if (value?.status === 401)
    return { code: "invalid_api_key", message: "OpenAI rejected the API key. Update OPENAI_API_KEY in .env and restart Testpaq." };
  if (value?.status === 403)
    return {
      code: "permission_denied",
      message: "This OpenAI key does not have permission to use the configured model. Check the project's key and model permissions.",
    };
  if (value?.status === 404)
    return {
      code: "model_unavailable",
      message: "The configured OpenAI model is unavailable to this key. Check TESTPAQ_OPENAI_MODEL and model access.",
    };
  if (value?.status === 429) return { code: "rate_limited", message: "OpenAI's request rate limit was reached. Wait briefly and retry." };
  if (value?.name === "APIConnectionTimeoutError")
    return { code: "provider_timeout", message: "OpenAI took too long to respond. Retry the request." };
  if (value?.name === "APIConnectionError")
    return { code: "provider_connection", message: "Could not connect to OpenAI. Check your internet connection and retry." };
  if (error instanceof z.ZodError || value?.name === "ZodError" || error instanceof SyntaxError)
    return { code: "invalid_analysis", message: "The provider response failed Testpaq's validation. Nothing was added." };
  return {
    code: "provider_error",
    message: "OpenAI could not complete the request. Nothing was added; check the configuration and retry.",
  };
}
