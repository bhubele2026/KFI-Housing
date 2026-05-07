/**
 * Operator identity helper (task #429).
 *
 * The HousingOps app currently has no auth layer — every request is
 * issued by "the operator at the keyboard". For audit features that
 * need a "who did this?" stamp (the snooze audit trail being the
 * first), we let each operator self-identify by storing an email /
 * handle in `localStorage` under `housingops:operator-email`.
 *
 * The value is read lazily on each call so flipping it from the
 * browser console (or a future Settings field) takes effect on the
 * very next action without a reload. When nothing is configured we
 * return the canonical fallback `"unknown"` so the audit field is
 * never empty for actions that *did* happen — that distinction
 * matters when investigating: blank means "no snooze recorded",
 * "unknown" means "snoozed but the operator hadn't set their email
 * yet".
 */

export const OPERATOR_EMAIL_STORAGE_KEY = "housingops:operator-email";
export const UNKNOWN_OPERATOR = "unknown";

export function getOperatorIdentity(): string {
  try {
    if (typeof localStorage === "undefined") return UNKNOWN_OPERATOR;
    const raw = localStorage.getItem(OPERATOR_EMAIL_STORAGE_KEY);
    const trimmed = (raw ?? "").trim();
    return trimmed === "" ? UNKNOWN_OPERATOR : trimmed;
  } catch {
    // localStorage can throw in privacy modes / sandboxed iframes.
    return UNKNOWN_OPERATOR;
  }
}
