import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Daily briefing (Task #671 Phase 6) — "Here's what needs you today",
 * ranked by DOLLARS AT RISK. This is the proactive front door: the
 * assistant dock fetches it on first load and the assistant can also
 * pull it via the `get_daily_briefing` read tool so any number it cites
 * traces to a tool result (grounding).
 *
 * It mirrors the headline semantics of the frontend
 * `computePropertyEconomics` (rent_cost − rent_recovered, charged-but-
 * not-placed) but computes them server-side with SQL aggregates so we
 * never re-derive the math in the model's head. The recovery period is
 * the latest month present in `payroll_deductions` (matching the lib's
 * default-period behaviour).
 *
 * NOTE on scope: "likely move-outs (housed people no longer on the
 * active roster)" from the plan is intentionally NOT computed here — it
 * requires a live Zenople AssignmentData pull, which is too heavy/fragile
 * to run inside a synchronous briefing fetch. Move-outs stay surfaced on
 * the Roster page; the briefing focuses on the three solid dollar
 * signals (recovery gaps, charged-but-not-placed, expiring leases).
 */

export interface BriefingItem {
  /** stable key for the finding type */
  key: string;
  title: string;
  detail: string;
  severity: "info" | "warn" | "critical";
  /** monthly dollars at risk, used for ranking */
  dollars: number;
  /** a prompt the operator can tap to have the assistant act on it */
  ctaPrompt: string;
}

export interface DailyBriefing {
  periodMonth: string;
  /** total monthly dollars at risk across all items */
  totalAtRisk: number;
  items: BriefingItem[];
  /** one-line plain-English headline for the dock */
  headline: string;
}

function rowsOf(result: unknown): any[] {
  return (result as unknown as { rows: any[] }).rows ?? (result as any) ?? [];
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function computeBriefing(now: Date = new Date()): Promise<DailyBriefing> {
  const items: BriefingItem[] = [];

  // Recovery period = latest YYYY-MM present in payroll_deductions.
  const periodRes = await db.execute(sql`
    SELECT COALESCE(MAX(substring(pay_week_end_date, 1, 7)), '') AS period
    FROM payroll_deductions
  `);
  const periodMonth = String(rowsOf(periodRes)?.[0]?.period ?? "");

  // 1. Top recovery-gap properties: rent cost (active leases) minus
  //    actual recovered deductions for the period. gap > 0 = housing loss.
  if (periodMonth) {
    const gapRes = await db.execute(sql`
      WITH rent AS (
        SELECT property_id, SUM(monthly_rent) AS cost
        FROM leases WHERE status = 'Active' GROUP BY property_id
      ), recovered AS (
        SELECT property_id, SUM(weekly_amount) AS rec
        FROM payroll_deductions
        WHERE substring(pay_week_end_date, 1, 7) = ${periodMonth}
          AND property_id <> ''
        GROUP BY property_id
      )
      SELECT p.id, p.name,
             COALESCE(rent.cost, 0)::float8 AS cost,
             COALESCE(recovered.rec, 0)::float8 AS rec
      FROM properties p
      LEFT JOIN rent ON rent.property_id = p.id
      LEFT JOIN recovered ON recovered.property_id = p.id
      WHERE COALESCE(p.status, 'Active') <> 'Inactive'
        AND COALESCE(rent.cost, 0) > 0
    `);
    const gapRows = rowsOf(gapRes)
      .map((r) => ({
        id: String(r.id),
        name: String(r.name || r.id),
        gap: Math.round((Number(r.cost) - Number(r.rec)) * 100) / 100,
      }))
      .filter((r) => r.gap > 0)
      .sort((a, b) => b.gap - a.gap);

    const totalGap = gapRows.reduce((s, r) => s + r.gap, 0);
    for (const r of gapRows.slice(0, 5)) {
      items.push({
        key: `recovery-gap:${r.id}`,
        title: `${r.name} is ${usd(r.gap)}/mo underwater`,
        detail: `You're paying more rent than you're recovering from payroll deductions at ${r.name}.`,
        severity: r.gap >= 1000 ? "warn" : "info",
        dollars: r.gap,
        ctaPrompt: `Show me the recovery gap for ${r.name} and what's driving it (empty beds vs under-collection).`,
      });
    }
    // Collapse the long tail into one summary item so the briefing stays short.
    if (gapRows.length > 5) {
      const tail = totalGap - gapRows.slice(0, 5).reduce((s, r) => s + r.gap, 0);
      items.push({
        key: "recovery-gap:tail",
        title: `${gapRows.length - 5} more properties under-recovering (${usd(tail)}/mo)`,
        detail: `Beyond the top 5, ${gapRows.length - 5} other properties are also losing money on housing.`,
        severity: "info",
        dollars: tail,
        ctaPrompt: `List every property whose housing recovery gap is positive, biggest first.`,
      });
    }
  }

  // 2. Charged but NOT placed — people with a deduction this period whose
  //    occupant has no bed/property. The killer leakage metric.
  if (periodMonth) {
    const cnpRes = await db.execute(sql`
      SELECT COUNT(DISTINCT d.occupant_id)::int AS cnt,
             COALESCE(SUM(d.weekly_amount), 0)::float8 AS dollars
      FROM payroll_deductions d
      LEFT JOIN occupants o ON o.id = d.occupant_id
      WHERE substring(d.pay_week_end_date, 1, 7) = ${periodMonth}
        AND d.occupant_id <> ''
        AND (
          o.id IS NULL
          OR o.bed_id IS NULL OR o.bed_id = ''
          OR o.property_id IS NULL OR o.property_id = ''
        )
    `);
    const cnp = rowsOf(cnpRes)?.[0];
    const cnpCount = Number(cnp?.cnt ?? 0);
    const cnpDollars = Math.round(Number(cnp?.dollars ?? 0) * 100) / 100;
    if (cnpCount > 0) {
      items.push({
        key: "charged-not-placed",
        title: `${cnpCount} ${cnpCount === 1 ? "person is" : "people are"} paying for housing but not in a bed (${usd(cnpDollars)}/mo)`,
        detail: `These people have a housing deduction this period but aren't assigned to a bed, so the money can't be tied to a property.`,
        severity: "warn",
        dollars: cnpDollars,
        ctaPrompt: `Show me everyone who's paying a housing deduction this period but isn't placed in a bed, so I can place them.`,
      });
    }
  }

  // 3. Active leases expiring within 30 days — monthly rent at risk if a
  //    renewal/notice decision is missed.
  const today = ymd(now);
  const in30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const expRes = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt, COALESCE(SUM(monthly_rent), 0)::float8 AS dollars
    FROM leases
    WHERE status = 'Active' AND end_date <> ''
      AND end_date >= ${today} AND end_date <= ${ymd(in30)}
  `);
  const exp = rowsOf(expRes)?.[0];
  const expCount = Number(exp?.cnt ?? 0);
  const expDollars = Math.round(Number(exp?.dollars ?? 0) * 100) / 100;
  if (expCount > 0) {
    items.push({
      key: "expiring-leases",
      title: `${expCount} lease${expCount === 1 ? "" : "s"} expiring within 30 days (${usd(expDollars)}/mo)`,
      detail: `Decide renewal or notice before these lapse to avoid a gap in housing.`,
      severity: "info",
      dollars: expDollars,
      ctaPrompt: `List the active leases expiring in the next 30 days with their rent and end dates.`,
    });
  }

  items.sort((a, b) => b.dollars - a.dollars);
  const totalAtRisk = Math.round(items.reduce((s, i) => s + i.dollars, 0) * 100) / 100;

  let headline: string;
  if (items.length === 0) {
    headline = "You're all caught up — no housing money at risk right now.";
  } else {
    const top = items[0];
    headline = `${items.length} thing${items.length === 1 ? "" : "s"} need you today — about ${usd(totalAtRisk)}/mo at risk. Biggest: ${top.title}.`;
  }

  return { periodMonth, totalAtRisk, items, headline };
}
