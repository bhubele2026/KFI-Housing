import { and, eq, lt, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  db,
  leasesTable,
  occupantsTable,
  bedsTable,
  propertiesTable,
  payrollDeductionsTable,
  assistantScannerRunsTable,
  vehiclesTable,
} from "@workspace/db";
import { emitNudge, parseScannerRecipientUserIds } from "../lib/assistant-nudges";
import { mostRecentSaturday } from "../lib/pay-week";

/**
 * Background nudge scanner (Task #671 Phase 4). Runs every 30 minutes
 * (with a 25-minute per-check guard so a fast restart can't double-fire)
 * and walks six checks against the live tables, emitting one nudge per
 * (recipient × finding) via `emitNudge`. Every find uses a stable
 * `ruleKey` so a finding seen twice does not insert twice — the dedup
 * happens at the DB level via UNIQUE (user_id, rule_key).
 *
 * Recipients come from the `ASSISTANT_SCANNER_RECIPIENT_USER_IDS` env
 * var (HousingOps has no users-for-customer model yet — see
 * `replit.md`). When the var is unset, the scanner runs the queries
 * but emits nothing — useful in dev where you want to confirm a check
 * is finding rows without flooding the dev account with nudges.
 */
export interface RunAssistantScanDeps {
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** Recipient user ids to attribute findings to. */
  recipientUserIds: string[];
  /** Current wall-clock; injected for tests. */
  now?: () => Date;
  /** Per-check skip window (ms). Default 25 minutes. */
  perCheckMinSpacingMs?: number;
  /** When true, ignore per-check spacing — used by the dev trigger. */
  force?: boolean;
}

interface CheckSummary {
  name: string;
  found: number;
  emitted: number;
  skipped: boolean;
}

const CHECKS = [
  "expiring-leases",
  "stale-needs-cleaning-beds",
  "missing-payroll",
  "leases-without-occupants",
  "occupants-without-leases",
  "dormant-properties",
  "idle-off-base-vans",
  "vehicle-registration-expiry",
  "vehicle-insurance-expiry",
] as const;
type CheckName = (typeof CHECKS)[number];

export async function runAssistantScan(
  deps: RunAssistantScanDeps,
): Promise<{ checks: CheckSummary[]; totalEmitted: number }> {
  const now = deps.now?.() ?? new Date();
  const minSpacing = deps.perCheckMinSpacingMs ?? 25 * 60_000;
  const recipients = deps.recipientUserIds;
  const summaries: CheckSummary[] = [];

  // Single round-trip to read every check's last-run timestamp.
  const runRows = await db.select().from(assistantScannerRunsTable);
  const lastRunBy = new Map<string, Date>();
  for (const r of runRows) lastRunBy.set(r.checkName, new Date(r.lastRunAt));

  for (const check of CHECKS) {
    const last = lastRunBy.get(check);
    if (!deps.force && last && now.getTime() - last.getTime() < minSpacing) {
      summaries.push({ name: check, found: 0, emitted: 0, skipped: true });
      continue;
    }
    try {
      const { found, emitted } = await runCheck(check, recipients, now);
      summaries.push({ name: check, found, emitted, skipped: false });
      await db
        .insert(assistantScannerRunsTable)
        .values({ checkName: check, lastRunAt: now })
        .onConflictDoUpdate({
          target: assistantScannerRunsTable.checkName,
          set: { lastRunAt: now },
        });
    } catch (err) {
      deps.logger.warn({ err, check }, "assistant-scanner: check failed");
      summaries.push({ name: check, found: 0, emitted: 0, skipped: false });
    }
  }

  const totalEmitted = summaries.reduce((a, s) => a + s.emitted, 0);
  deps.logger.info(
    { totalEmitted, recipients: recipients.length, summaries },
    "assistant-scanner: run complete",
  );
  return { checks: summaries, totalEmitted };
}

async function runCheck(
  check: CheckName,
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  switch (check) {
    case "expiring-leases":
      return runExpiringLeasesCheck(recipients, now);
    case "stale-needs-cleaning-beds":
      return runStaleNeedsCleaningBedsCheck(recipients, now);
    case "missing-payroll":
      return runMissingPayrollCheck(recipients, now);
    case "leases-without-occupants":
      return runLeasesWithoutOccupantsCheck(recipients);
    case "occupants-without-leases":
      return runOccupantsWithoutLeasesCheck(recipients);
    case "dormant-properties":
      return runDormantPropertiesCheck(recipients, now);
    case "idle-off-base-vans":
      return runIdleOffBaseVansCheck(recipients);
    case "vehicle-registration-expiry":
      return runVehicleRegistrationExpiryCheck(recipients, now);
    case "vehicle-insurance-expiry":
      return runVehicleInsuranceExpiryCheck(recipients, now);
  }
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

async function emitToAll(
  recipients: string[],
  base: Omit<Parameters<typeof emitNudge>[0], "userId">,
): Promise<number> {
  let emitted = 0;
  for (const uid of recipients) {
    const r = await emitNudge({ ...base, userId: uid });
    if (r.inserted) emitted += 1;
  }
  return emitted;
}

// Check 1: leases ending within 30/14/7 days. Three rule-key buckets per
// lease so the operator sees a fresh nudge at each marker instead of a
// single stale one — and the 7d nudge bumps severity to "warn".
async function runExpiringLeasesCheck(
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  const today = ymd(now);
  const cutoff = ymd(addDays(now, 30));
  const rows = await db
    .select({
      id: leasesTable.id,
      endDate: leasesTable.endDate,
      propertyId: leasesTable.propertyId,
      customerId: leasesTable.customerId,
    })
    .from(leasesTable)
    .where(
      and(
        eq(leasesTable.status, "Active"),
        sql`${leasesTable.endDate} <> ''`,
        sql`${leasesTable.endDate} >= ${today}`,
        sql`${leasesTable.endDate} <= ${cutoff}`,
      ),
    );
  let emitted = 0;
  for (const lease of rows) {
    const end = new Date(lease.endDate);
    const daysOut = Math.max(
      0,
      Math.round((end.getTime() - now.getTime()) / 86_400_000),
    );
    let marker: 30 | 14 | 7;
    let severity: "info" | "warn" = "info";
    if (daysOut <= 7) {
      marker = 7;
      severity = "warn";
    } else if (daysOut <= 14) {
      marker = 14;
    } else {
      marker = 30;
    }
    emitted += await emitToAll(recipients, {
      ruleKey: `expiring-lease:${lease.id}:${marker}d`,
      source: "scanner",
      severity,
      customerId: lease.customerId ?? null,
      title: `Lease ${lease.id} ends in ${daysOut} day${daysOut === 1 ? "" : "s"}`,
      body: `Ends ${lease.endDate}. Decide on renewal, notice, or buyout.`,
      ctaLabel: "Open lease",
      ctaPrompt: `Show me lease ${lease.id} and its renewal options.`,
      pagePattern: "/leases",
      anchorType: "lease",
      anchorId: lease.id,
    });
  }
  return { found: rows.length, emitted };
}

// Check 2: beds sitting in needs_cleaning for > 7 days. Uses the
// dedicated `needs_cleaning_since` column (task #675) — the API
// boundary stamps it on the transition into needs_cleaning so we get
// an exact waiting age. For legacy rows that pre-date the column and
// somehow still carry NULL despite the back-fill, we fall back to
// `updated_at` (the previous approximation). Dedup is per-bed so the
// nudge persists until the bed leaves needs_cleaning.
async function runStaleNeedsCleaningBedsCheck(
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const rows = await db
    .select({
      id: bedsTable.id,
      propertyId: bedsTable.propertyId,
      bedNumber: bedsTable.bedNumber,
      needsCleaningSince: bedsTable.needsCleaningSince,
      updatedAt: bedsTable.updatedAt,
    })
    .from(bedsTable)
    .where(
      and(
        eq(bedsTable.cleaningStatus, "needs_cleaning"),
        lt(
          sql`COALESCE(${bedsTable.needsCleaningSince}, ${bedsTable.updatedAt})`,
          cutoff,
        ),
      ),
    );
  let emitted = 0;
  for (const bed of rows) {
    const since = bed.needsCleaningSince ?? bed.updatedAt;
    const days = Math.max(
      1,
      Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000),
    );
    emitted += await emitToAll(recipients, {
      ruleKey: `stale-needs-cleaning-bed:${bed.id}`,
      source: "scanner",
      severity: "info",
      title: `Bed ${bed.id} has been waiting ${days} day${days === 1 ? "" : "s"} for cleaning`,
      body: `Bed #${bed.bedNumber} at property ${bed.propertyId} entered needs_cleaning ${days} day${days === 1 ? "" : "s"} ago.`,
      ctaLabel: "Mark ready",
      ctaPrompt: `Update bed ${bed.id} cleaningStatus to ready.`,
      pagePattern: `/properties/${bed.propertyId}`,
      anchorType: "bed",
      anchorId: bed.id,
    });
  }
  return { found: rows.length, emitted };
}

// Check 3: active occupants with no payroll_deductions row for the
// most recent Mon→Sat pay-week. Stable rule key per (occupant, week)
// so the nudge re-fires once per week when payroll continues to skip
// them.
async function runMissingPayrollCheck(
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  const week = mostRecentSaturday(now);
  const rows = await db.execute(sql`
    SELECT o.id, o.name, o.property_id, o.charge_source_customer
    FROM occupants o
    WHERE o.status = 'Active'
      AND COALESCE(o.charge_per_bed, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM payroll_deductions d
        WHERE d.occupant_id = o.id
          AND d.pay_week_end_date = ${week}
      )
    LIMIT 500
  `);
  const list = (rows as unknown as { rows: any[] }).rows ?? (rows as any);
  let emitted = 0;
  for (const r of list as any[]) {
    const id = String(r.id);
    const name = String(r.name ?? "");
    const propertyId = r.property_id ?? null;
    const customerId = r.charge_source_customer ?? null;
    emitted += await emitToAll(recipients, {
      ruleKey: `occupant-missing-payroll:${id}:${week}`,
      source: "scanner",
      severity: "info",
      customerId,
      title: `No payroll deduction for ${name || id} (week of ${week})`,
      body: `Active occupant has a per-bed charge but no payroll snapshot for week ending ${week}.`,
      ctaLabel: "Open occupant",
      ctaPrompt: `Show occupant ${id} and their recent payroll deductions.`,
      pagePattern: "/occupants",
      anchorType: "occupant",
      anchorId: id,
    });
  }
  return { found: list.length, emitted };
}

// Check 4: active leases that have no active occupants underneath
// them (via the property). Common red flag — a lease that's billing
// the customer but nobody's actually staying there.
async function runLeasesWithoutOccupantsCheck(
  recipients: string[],
): Promise<{ found: number; emitted: number }> {
  const rows = await db.execute(sql`
    SELECT l.id, l.property_id, l.customer_id, l.end_date
    FROM leases l
    WHERE l.status = 'Active'
      AND NOT EXISTS (
        SELECT 1 FROM occupants o
        WHERE o.property_id = l.property_id
          AND o.status = 'Active'
      )
    LIMIT 500
  `);
  const list = (rows as unknown as { rows: any[] }).rows ?? (rows as any);
  let emitted = 0;
  for (const r of list as any[]) {
    const id = String(r.id);
    const propertyId = r.property_id ?? "";
    const customerId = r.customer_id ?? null;
    emitted += await emitToAll(recipients, {
      ruleKey: `lease-no-occupants:${id}`,
      source: "scanner",
      severity: "warn",
      customerId,
      title: `Lease ${id} has no active occupants`,
      body: `Active lease at property ${propertyId} but no occupants assigned. Check assignments or end the lease.`,
      ctaLabel: "Open lease",
      ctaPrompt: `Show lease ${id} and its occupants.`,
      pagePattern: "/leases",
      anchorType: "lease",
      anchorId: id,
    });
  }
  return { found: list.length, emitted };
}

// Check 5: active occupants with no active lease on their property.
// Surfaces the inverse situation — somebody assigned to a bed under a
// property whose lease is expired/cancelled.
async function runOccupantsWithoutLeasesCheck(
  recipients: string[],
): Promise<{ found: number; emitted: number }> {
  const rows = await db.execute(sql`
    SELECT o.id, o.name, o.property_id, o.charge_source_customer
    FROM occupants o
    WHERE o.status = 'Active'
      AND o.property_id IS NOT NULL
      AND o.property_id <> ''
      AND NOT EXISTS (
        SELECT 1 FROM leases l
        WHERE l.property_id = o.property_id
          AND l.status = 'Active'
      )
    LIMIT 500
  `);
  const list = (rows as unknown as { rows: any[] }).rows ?? (rows as any);
  let emitted = 0;
  for (const r of list as any[]) {
    const id = String(r.id);
    const name = String(r.name ?? "");
    const propertyId = r.property_id ?? "";
    const customerId = r.charge_source_customer ?? null;
    emitted += await emitToAll(recipients, {
      ruleKey: `occupant-no-lease:${id}`,
      source: "scanner",
      severity: "warn",
      customerId,
      title: `${name || id} has no active lease`,
      body: `Active occupant at property ${propertyId} but no active lease covers them.`,
      ctaLabel: "Open occupant",
      ctaPrompt: `Show occupant ${id} and the lease history for their property.`,
      pagePattern: "/occupants",
      anchorType: "occupant",
      anchorId: id,
    });
  }
  return { found: list.length, emitted };
}

// Check 6: properties that haven't been touched in 30+ days. Task
// #676 added `properties.updated_at`, maintained by DB triggers that
// bump the column on any direct property write and on any
// INSERT/UPDATE/DELETE against a child row (lease, occupant, bed,
// room, building, utility, other-cost, insurance certificate,
// violation, projected move-in, payroll deduction). That makes
// "last activity" a single column read instead of a NOT EXISTS sweep
// across half the schema, and lets the dashboard surface the same
// list using the same signal.
async function runDormantPropertiesCheck(
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  const cutoffIso = new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString();
  const rows = await db.execute(sql`
    SELECT p.id, p.name, p.customer_id
    FROM properties p
    WHERE p.updated_at < ${cutoffIso}::timestamptz
      AND NOT EXISTS (
            SELECT 1 FROM leases l WHERE l.property_id = p.id AND l.status = 'Active'
          )
      AND NOT EXISTS (
            SELECT 1 FROM occupants o WHERE o.property_id = p.id AND o.status = 'Active'
          )
    LIMIT 500
  `);
  const list = (rows as unknown as { rows: any[] }).rows ?? (rows as any);
  let emitted = 0;
  for (const r of list as any[]) {
    const id = String(r.id);
    const name = String(r.name ?? "");
    const customerId = r.customer_id ?? null;
    emitted += await emitToAll(recipients, {
      ruleKey: `dormant-property:${id}`,
      source: "scanner",
      severity: "info",
      customerId,
      title: `${name || id} is dormant`,
      body: `No active leases or occupants. Confirm the property is still in service or archive it.`,
      ctaLabel: "Open property",
      ctaPrompt: `Show property ${id} and its recent activity.`,
      pagePattern: "/properties",
      anchorType: "property",
      anchorId: id,
    });
  }
  return { found: list.length, emitted };
}

// Check 7 (Transportation): vans that are Available and parked off-base
// (a non-blank current-location note) — i.e. not in use for a client and
// sitting somewhere it should be brought back to WI from. Dedup per-van
// so the nudge persists until the van is put back in use / the note is
// cleared.
async function runIdleOffBaseVansCheck(
  recipients: string[],
): Promise<{ found: number; emitted: number }> {
  const rows = await db
    .select({
      id: vehiclesTable.id,
      merchantUnit: vehiclesTable.merchantUnit,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      loc: vehiclesTable.currentLocationNote,
      homeBaseState: vehiclesTable.homeBaseState,
      customerId: vehiclesTable.customerId,
    })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.status, "Available"),
        sql`${vehiclesTable.currentLocationNote} <> ''`,
      ),
    );
  let emitted = 0;
  for (const v of rows) {
    const label =
      v.merchantUnit || [v.make, v.model].filter(Boolean).join(" ") || v.id;
    emitted += await emitToAll(recipients, {
      ruleKey: `idle-van:${v.id}`,
      source: "scanner",
      severity: "info",
      customerId: v.customerId || null,
      title: `Van ${label} is idle off-base`,
      body: `Available and parked at "${v.loc}". Goal is to bring it back to ${v.homeBaseState || "WI"}.`,
      ctaLabel: "Open vehicles",
      ctaPrompt: `Show van ${v.id} — it's available and sitting off-base.`,
      pagePattern: "/transport/vehicles",
      anchorType: "vehicle",
      anchorId: v.id,
    });
  }
  return { found: rows.length, emitted };
}

// Check 8 (Transportation): vehicle registrations expiring within 30
// days (or already expired). YMD text column compares lexicographically.
async function runVehicleRegistrationExpiryCheck(
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  const cutoff = ymd(addDays(now, 30));
  const rows = await db
    .select({
      id: vehiclesTable.id,
      merchantUnit: vehiclesTable.merchantUnit,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      reg: vehiclesTable.registrationExpires,
      customerId: vehiclesTable.customerId,
    })
    .from(vehiclesTable)
    .where(
      and(
        sql`${vehiclesTable.registrationExpires} <> ''`,
        sql`${vehiclesTable.registrationExpires} <= ${cutoff}`,
      ),
    );
  let emitted = 0;
  for (const v of rows) {
    const label =
      v.merchantUnit || [v.make, v.model].filter(Boolean).join(" ") || v.id;
    const days = Math.round(
      (new Date(v.reg).getTime() - now.getTime()) / 86_400_000,
    );
    const past = days < 0;
    emitted += await emitToAll(recipients, {
      ruleKey: `vehicle-registration:${v.id}`,
      source: "scanner",
      severity: past ? "warn" : "info",
      customerId: v.customerId || null,
      title: `Registration for van ${label} ${past ? "has expired" : `expires in ${days} day${days === 1 ? "" : "s"}`}`,
      body: `Plate registration ${past ? `expired ${-days} day${days === -1 ? "" : "s"} ago` : `expires`} (${v.reg}). Renew it.`,
      ctaLabel: "Open vehicles",
      ctaPrompt: `Show van ${v.id} and its registration.`,
      pagePattern: "/transport/vehicles",
      anchorType: "vehicle",
      anchorId: v.id,
    });
  }
  return { found: rows.length, emitted };
}

// Check 9 (Transportation): vehicle insurance policies expiring within
// 30 days (or already expired). Joined to vehicles for a friendly label.
async function runVehicleInsuranceExpiryCheck(
  recipients: string[],
  now: Date,
): Promise<{ found: number; emitted: number }> {
  const cutoff = ymd(addDays(now, 30));
  const rows = await db.execute(sql`
    SELECT vi.id, vi.vehicle_id, vi.expiry_date, vi.carrier,
           v.merchant_unit, v.make, v.model, v.customer_id
    FROM vehicle_insurance vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.expiry_date <> '' AND vi.expiry_date <= ${cutoff}
    LIMIT 500
  `);
  const list = (rows as unknown as { rows: any[] }).rows ?? (rows as any);
  let emitted = 0;
  for (const r of list as any[]) {
    const policyId = String(r.id);
    const vehicleId = String(r.vehicle_id ?? "");
    const label =
      String(r.merchant_unit || "") ||
      [r.make, r.model].filter(Boolean).join(" ") ||
      vehicleId;
    const expiry = String(r.expiry_date ?? "");
    const days = Math.round((new Date(expiry).getTime() - now.getTime()) / 86_400_000);
    const past = days < 0;
    emitted += await emitToAll(recipients, {
      ruleKey: `vehicle-insurance:${policyId}`,
      source: "scanner",
      severity: past ? "warn" : "info",
      customerId: r.customer_id || null,
      title: `Insurance for van ${label} ${past ? "has expired" : `expires in ${days} day${days === 1 ? "" : "s"}`}`,
      body: `${String(r.carrier || "Policy")} coverage ${past ? "expired" : "expires"} ${expiry}. Renew before it lapses.`,
      ctaLabel: "Open vehicles",
      ctaPrompt: `Show van ${vehicleId} and its insurance.`,
      pagePattern: "/transport/vehicles",
      anchorType: "vehicle",
      anchorId: vehicleId,
    });
  }
  return { found: list.length, emitted };
}

/**
 * Start the periodic scanner (Task #671 Phase 4). Pattern mirrors
 * insurance-expiry-scheduler: a `setInterval` that wakes every
 * `intervalMs` (default 30 minutes) and invokes `runAssistantScan`,
 * with a one-shot 5-minute warm-up timer so the boot path isn't
 * delayed waiting on the first scan.
 */
export interface StartAssistantScannerSchedulerDeps {
  logger: Pick<Logger, "info" | "warn" | "error">;
  env: NodeJS.ProcessEnv;
  intervalMs?: number;
  warmupMs?: number;
  setIntervalFn?: (cb: () => void, ms: number) => { unref?: () => void };
  setTimeoutFn?: (cb: () => void, ms: number) => { unref?: () => void };
}

export function startAssistantScannerScheduler(
  deps: StartAssistantScannerSchedulerDeps,
): void {
  const intervalMs = deps.intervalMs ?? 30 * 60_000;
  const warmupMs = deps.warmupMs ?? 5 * 60_000;
  const recipients = parseScannerRecipientUserIds(deps.env);
  const setIntervalImpl = deps.setIntervalFn ?? setInterval;
  const setTimeoutImpl = deps.setTimeoutFn ?? setTimeout;

  if (recipients.length === 0) {
    deps.logger.info(
      "assistant-scanner: ASSISTANT_SCANNER_RECIPIENT_USER_IDS is unset; the scanner will run but emit no nudges.",
    );
  } else {
    deps.logger.info(
      { recipients: recipients.length, intervalMs },
      "assistant-scanner: scheduler started",
    );
  }

  const tick = async (): Promise<void> => {
    try {
      await runAssistantScan({
        logger: deps.logger,
        recipientUserIds: recipients,
      });
    } catch (err) {
      deps.logger.error({ err }, "assistant-scanner: run failed");
    }
  };

  const warm = setTimeoutImpl(() => {
    void tick();
  }, warmupMs);
  warm.unref?.();
  const handle = setIntervalImpl(() => {
    void tick();
  }, intervalMs);
  handle.unref?.();
}
