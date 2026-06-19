import Anthropic from "@anthropic-ai/sdk";

if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
  );
}

export const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

/**
 * Single source of truth for the model id used by every KFI Staffing AI
 * call (the assistant + lease-PDF extraction). Import this — never inline a
 * model string.
 *
 * Target: **Claude Opus 4.8** (`claude-opus-4-8`) — the current strongest
 * model. IMPORTANT: these requests go through the Replit Anthropic proxy
 * (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL`), which must actually serve this id.
 * We cannot probe the proxy's model list locally (secrets are Replit-only),
 * so this is documented rather than auto-detected. If a deploy surfaces a
 * "model not found" / 404 from the proxy, fall back to `claude-sonnet-4-6`
 * (still a real upgrade over the previous `claude-sonnet-4-5`) by changing
 * only this constant.
 */
export const ASSISTANT_MODEL = "claude-opus-4-8";

/**
 * Reasoning-effort levels for Opus 4.8. The assistant's interactive turns
 * plan multi-step housing operations, so they run at HIGH effort; the
 * lease-PDF extraction path is a narrow structured-output task, so it runs
 * at LOW effort to stay cheap/fast.
 *
 * NOTE: the `effort` request field may not yet be present in the
 * `@anthropic-ai/sdk` (^0.78.0) request types. Call sites add it cast-safe
 * so typecheck stays green whether or not the installed SDK types include
 * it. Confirm the exact field name/values against the SDK version on Replit.
 */
export const ASSISTANT_EFFORT = "high" as const;
export const EXTRACTION_EFFORT = "low" as const;
