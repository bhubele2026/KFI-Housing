import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, assistantNudgesTable } from "@workspace/db";
import { logger as serverLogger } from "./logger";

/**
 * Stable-id contract for nudges (Task #671 Phases 2–4).
 *
 * `emitNudge` is the single insert path used by:
 *   - the proposal-confirm route (event nudges raised after a
 *     successful import_master_leases / import_payroll_deductions);
 *   - the GET /assistant/nudges materialiser when an operator
 *     dismisses or snoozes a computed page-context nudge;
 *   - the background `runAssistantScan()` job.
 *
 * The dedup contract is `UNIQUE (user_id, rule_key)`. Every caller
 * builds a stable rule key (e.g. `expiring-lease:l-123:30d`) so a
 * repeated scan run finding the same problem twice does not insert a
 * duplicate row — the `ON CONFLICT DO NOTHING` clause makes the call
 * idempotent.
 */
export interface EmitNudgeInput {
  userId: string;
  ruleKey: string;
  source: "event" | "page" | "scanner";
  title: string;
  body?: string;
  severity?: "info" | "warn" | "critical";
  customerId?: string | null;
  ctaLabel?: string | null;
  ctaPrompt?: string | null;
  pagePattern?: string | null;
  anchorType?: string | null;
  anchorId?: string | null;
  relatedProposalId?: string | null;
}

export interface EmitNudgeResult {
  inserted: boolean;
}

export async function emitNudge(
  input: EmitNudgeInput,
): Promise<EmitNudgeResult> {
  if (!input.userId || !input.ruleKey || !input.title) {
    return { inserted: false };
  }
  const id = `nudge-${randomUUID()}`;
  // ON CONFLICT DO NOTHING on (user_id, rule_key) is the dedup
  // primitive. .returning() lets us tell the caller whether the row
  // actually landed — useful for telemetry on "scanner found this for
  // the first time".
  const inserted = await db
    .insert(assistantNudgesTable)
    .values({
      id,
      userId: input.userId,
      customerId: input.customerId ?? null,
      ruleKey: input.ruleKey,
      source: input.source,
      severity: input.severity ?? "info",
      title: input.title,
      body: input.body ?? "",
      ctaLabel: input.ctaLabel ?? null,
      ctaPrompt: input.ctaPrompt ?? null,
      pagePattern: input.pagePattern ?? null,
      anchorType: input.anchorType ?? null,
      anchorId: input.anchorId ?? null,
      relatedProposalId: input.relatedProposalId ?? null,
    })
    .onConflictDoNothing({
      target: [assistantNudgesTable.userId, assistantNudgesTable.ruleKey],
    })
    .returning({ id: assistantNudgesTable.id });
  const result = { inserted: inserted.length > 0 };
  if (result.inserted) {
    // Structured telemetry — required by Task #671. Logged only on
    // first-time emission (the ON CONFLICT DO NOTHING swallows
    // repeats) so we can measure new-finding rate per rule key
    // without log volume from steady-state re-scans.
    serverLogger.info(
      {
        event: "assistant_nudge.create",
        userId: input.userId,
        nudgeId: id,
        ruleKey: input.ruleKey,
        source: input.source,
        severity: input.severity ?? "info",
        anchorType: input.anchorType ?? null,
        anchorId: input.anchorId ?? null,
        customerId: input.customerId ?? null,
        relatedProposalId: input.relatedProposalId ?? null,
      },
      "assistant-nudges: create",
    );
  }
  return result;
}

/**
 * Parse the `ASSISTANT_SCANNER_RECIPIENT_USER_IDS` env var into a
 * trimmed, deduped list. Comma- or whitespace-separated. Empty when
 * the env var is unset — the scanner skips emission entirely in that
 * case so a misconfigured environment doesn't silently drop nudges
 * into an empty void.
 *
 * HousingOps does not yet have a "users-for-customer" model, so the
 * scanner attributes its findings to this static recipient list. See
 * `replit.md` for the operator-facing documentation.
 */
export function parseScannerRecipientUserIds(
  env: NodeJS.ProcessEnv,
): string[] {
  const raw = env["ASSISTANT_SCANNER_RECIPIENT_USER_IDS"] ?? "";
  const out = new Set<string>();
  for (const piece of raw.split(/[,\s]+/)) {
    const t = piece.trim();
    if (t) out.add(t);
  }
  return Array.from(out);
}

/** Re-export the dedup SQL primitive so call sites can compose it. */
export const NUDGE_DEDUP_TARGET = sql`(user_id, rule_key)`;
