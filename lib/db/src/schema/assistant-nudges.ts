import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Persistent nudge cards rendered above the chat input in the
 * assistant bubble (Task #671 — Phases 2–4 of the proactive-assistant
 * roadmap).
 *
 * A nudge is a short, dismissible card the assistant raises on its own
 * (no operator prompt required) when it spots something worth flagging
 * — an import that finished, a lease about to expire, a bed that's
 * been sitting needs_cleaning for too long, etc. Source falls into one
 * of three buckets:
 *   - "event"   → raised in-line by a workflow that just happened
 *                 (e.g. an import_master_leases tool returning a
 *                 summary card after the operator confirms it).
 *   - "page"    → computed on the fly per-page (this row only
 *                 materialises when the operator dismisses/snoozes a
 *                 computed nudge — see "computed-" id handling below).
 *   - "scanner" → produced by the background `runAssistantScan()`
 *                 job (expiring leases at 30/14/7 markers, stale
 *                 needs_cleaning beds, missing payroll, etc.).
 *
 * The `UNIQUE (user_id, rule_key)` index is the dedup contract — every
 * call to `emitNudge` uses a stable `ruleKey` so a scan run finding
 * the same problem twice does not double-count. Snoozed/dismissed
 * state lives on the row so an operator's choice survives across
 * scans without us inserting a fresh duplicate.
 */
export const assistantNudgesTable = pgTable(
  "assistant_nudges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    // null = "any scope" (the nudge surfaces regardless of which
    // customer the operator has the dropdown set to).
    customerId: text("customer_id"),
    ruleKey: text("rule_key").notNull(),
    // "event" | "page" | "scanner" — see header comment.
    source: text("source").notNull(),
    // "info" | "warn" | "critical" — drives the colour of the
    // severity dot in the card and the badge tone on the closed bubble.
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    ctaLabel: text("cta_label"),
    ctaPrompt: text("cta_prompt"),
    // Optional URL pattern (substring match against the current page)
    // that limits where the nudge renders. Null = render everywhere.
    pagePattern: text("page_pattern"),
    // Optional anchor — the entity the nudge relates to. Lets the UI
    // jump straight to the row and the scanner dedup matches per-anchor
    // when the rule key is anchor-keyed.
    anchorType: text("anchor_type"),
    anchorId: text("anchor_id"),
    // Set for event-style nudges raised after a proposal resolves
    // (e.g. import_summary cards). Lets the UI link back to the
    // proposal that produced it.
    relatedProposalId: text("related_proposal_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  },
  (t) => ({
    // GET /assistant/nudges filters on (userId, dismissedAt IS NULL,
    // snoozedUntil < now()) — the composite covers the hot path.
    activeIdx: index("assistant_nudges_active_idx").on(
      t.userId,
      t.dismissedAt,
      t.snoozedUntil,
    ),
    // The dedup contract (see header). `emitNudge` uses
    // `ON CONFLICT (user_id, rule_key) DO NOTHING`.
    ruleKeyUniq: uniqueIndex("assistant_nudges_user_rule_unique").on(
      t.userId,
      t.ruleKey,
    ),
    // Anchor lookup for "show me everything pointing at this lease".
    anchorIdx: index("assistant_nudges_anchor_idx").on(
      t.anchorType,
      t.anchorId,
    ),
  }),
);

export type AssistantNudgeRow = typeof assistantNudgesTable.$inferSelect;
export type InsertAssistantNudgeRow = typeof assistantNudgesTable.$inferInsert;

/**
 * Per-check rate-limit table used by `runAssistantScan()` (Task #671
 * Phase 4). Each scanner check writes its name + last successful run
 * time so the next scheduled invocation can skip a check that ran
 * within the last 25 minutes — preventing the 30-minute interval from
 * stacking up extra work after a deploy or a manual dev trigger.
 */
export const assistantScannerRunsTable = pgTable(
  "assistant_scanner_runs",
  {
    checkName: text("check_name").primaryKey(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export type AssistantScannerRunRow =
  typeof assistantScannerRunsTable.$inferSelect;
export type InsertAssistantScannerRunRow =
  typeof assistantScannerRunsTable.$inferInsert;
