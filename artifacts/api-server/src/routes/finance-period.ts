import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  propertiesTable,
  payrollDeductionsTable,
  weeklyReviewsTable,
} from "@workspace/db";
import {
  mostRecentSaturday,
  monthBucketForPayWeek,
  trailingPayWeeks,
  parsePayWeekDate,
  WEEKS_PER_MONTH,
} from "../lib/pay-week";
import { fetchHousingDeductionsByWeek } from "../lib/zenople-client";
import { logger } from "../lib/logger";

// Completion Runbook B — week-by-week Money review.
// Direct-fetch routes (NOT in openapi; matches the roster/zenople-match
// precedent so a YAML slip can't break codegen for the whole client).
// Every period is floored at go-live so we never surface pre-app data.
const GO_LIVE = "2026-06-01";
const router: IRouter = Router();

type Kind = "this-week" | "last-week" | "this-month" | "last-month" | "this-quarter";

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function prevMonthBucket(b: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(b);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1 - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function quarterMonthsOf(b: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(b);
  if (!m) return [];
  const y = Number(m[1]);
  const qStart = Math.floor((Number(m[2]) - 1) / 3) * 3; // 0,3,6,9
  return [0, 1, 2].map((i) => {
    const d = new Date(y, qStart + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function quarterLabel(b: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(b);
  if (!m) return b;
  const q = Math.floor((Number(m[2]) - 1) / 3) + 1;
  return `${m[1]}-Q${q}`;
}

/** All Saturday pay-weeks from go-live through the most recent, ascending. */
function liveSaturdays(now: Date): string[] {
  return trailingPayWeeks(90, mostRecentSaturday(now)).filter((s) => s >= GO_LIVE);
}

/** The Saturday weeks (and a periodKey/label) for the current + prior period. */
function resolvePeriod(
  kind: Kind,
  now: Date,
): { key: string; label: string; current: string[]; prior: string[] } {
  const sats = liveSaturdays(now);
  const latest = sats[sats.length - 1] ?? mostRecentSaturday(now);

  if (kind === "this-week" || kind === "last-week") {
    const idx = kind === "this-week" ? sats.length - 1 : sats.length - 2;
    const cur = sats[idx] ? [sats[idx]] : [];
    const pri = sats[idx - 1] ? [sats[idx - 1]] : [];
    return { key: cur[0] ?? latest, label: cur[0] ?? "—", current: cur, prior: pri };
  }

  const weeksInMonth = (bucket: string) =>
    sats.filter((s) => monthBucketForPayWeek(s) === bucket);

  if (kind === "this-month" || kind === "last-month") {
    const thisM = monthBucketForPayWeek(latest);
    const curM = kind === "this-month" ? thisM : prevMonthBucket(thisM);
    const priM = prevMonthBucket(curM);
    return {
      key: curM,
      label: curM,
      current: weeksInMonth(curM),
      prior: weeksInMonth(priM),
    };
  }

  // this-quarter
  const thisM = monthBucketForPayWeek(latest);
  const curMonths = quarterMonthsOf(thisM);
  const priMonths = quarterMonthsOf(prevMonthBucket(curMonths[0] ?? thisM)).length
    ? quarterMonthsOf(prevMonthBucket(curMonths[0]))
    : [];
  const inMonths = (months: string[]) =>
    sats.filter((s) => months.includes(monthBucketForPayWeek(s)));
  return {
    key: quarterLabel(thisM),
    label: quarterLabel(thisM),
    current: inMonths(curMonths),
    prior: inMonths(priMonths),
  };
}

async function loadInputs(): Promise<{
  rentWeekly: number;
  activeProperties: number;
  collectedByWeek: Map<string, number>;
  personsByWeek: Map<
    string,
    Map<string, { personId: string; name: string; company: string; propertyId: string; amount: number }>
  >;
}> {
  let rentWeekly = 0;
  let activeProperties = 0;
  try {
    const props = await db.select().from(propertiesTable);
    for (const p of props) {
      const status = String((p as { status?: string }).status ?? "");
      if (status === "Inactive") continue;
      const rent = Number((p as { monthlyRent?: number }).monthlyRent ?? 0) || 0;
      activeProperties += 1;
      rentWeekly += rent / WEEKS_PER_MONTH;
    }
  } catch (err) {
    logger.warn({ err }, "finance/period: property rent load failed");
  }

  const collectedByWeek = new Map<string, number>();
  // Phase 2 — per-person rollup keyed by week, so the period's PEOPLE count
  // and the WHO-WAS-DEDUCTED table come from the SAME rows as the headline
  // DEDUCTED total (they can never disagree).
  type Person = { personId: string; name: string; company: string; propertyId: string; amount: number };
  const personsByWeek = new Map<string, Map<string, Person>>();
  try {
    const rows = await db
      .select({
        payWeekEndDate: payrollDeductionsTable.payWeekEndDate,
        weeklyAmount: payrollDeductionsTable.weeklyAmount,
        personId: payrollDeductionsTable.personId,
        occupantId: payrollDeductionsTable.occupantId,
        name: payrollDeductionsTable.nameSnapshot,
        company: payrollDeductionsTable.customerSnapshot,
        propertyId: payrollDeductionsTable.propertyId,
      })
      .from(payrollDeductionsTable);
    for (const r of rows) {
      const wk = String(r.payWeekEndDate);
      const amt = Number(r.weeklyAmount) || 0;
      collectedByWeek.set(wk, (collectedByWeek.get(wk) ?? 0) + amt);
      const pid = r.personId || r.occupantId || r.name || `${wk}-${r.name}`;
      let m = personsByWeek.get(wk);
      if (!m) {
        m = new Map<string, Person>();
        personsByWeek.set(wk, m);
      }
      const prev = m.get(pid);
      m.set(pid, {
        personId: pid,
        name: r.name || "—",
        company: r.company || "",
        propertyId: r.propertyId || "",
        amount: (prev?.amount ?? 0) + amt,
      });
    }
  } catch (err) {
    logger.warn({ err }, "finance/period: deduction load failed");
  }

  return { rentWeekly, activeProperties, collectedByWeek, personsByWeek };
}

/** Roll the per-week person maps up across a period's weeks (summing amounts). */
function peopleForWeeks(
  weeks: string[],
  personsByWeek: Map<string, Map<string, { personId: string; name: string; company: string; propertyId: string; amount: number }>>,
): { name: string; company: string; propertyId: string; amount: number }[] {
  const merged = new Map<string, { name: string; company: string; propertyId: string; amount: number }>();
  for (const wk of weeks) {
    const m = personsByWeek.get(wk);
    if (!m) continue;
    for (const [pid, p] of m) {
      const prev = merged.get(pid);
      merged.set(pid, {
        name: p.name,
        company: p.company,
        propertyId: p.propertyId,
        amount: (prev?.amount ?? 0) + p.amount,
      });
    }
  }
  return [...merged.values()].filter((p) => p.amount > 0).sort((a, b) => b.amount - a.amount);
}

function sumWeeks(weeks: string[], collectedByWeek: Map<string, number>): number {
  return weeks.reduce((acc, w) => acc + (collectedByWeek.get(w) ?? 0), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// GET /api/finance/period?kind=this-week|last-week|this-month|last-month|this-quarter
router.get("/finance/period", async (req, res): Promise<void> => {
  try {
    const kindRaw = String(req.query.kind ?? "this-week");
    const allowed: Kind[] = ["this-week", "last-week", "this-month", "last-month", "this-quarter"];
    const kind: Kind = (allowed as string[]).includes(kindRaw) ? (kindRaw as Kind) : "this-week";

    const { key, label, current, prior } = resolvePeriod(kind, new Date());
    const { rentWeekly, activeProperties, collectedByWeek, personsByWeek } = await loadInputs();

    const build = (weeks: string[]) => {
      const collected = round2(sumWeeks(weeks, collectedByWeek));
      const rent = round2(rentWeekly * weeks.length);
      return { collected, rent, net: round2(collected - rent), weeks: weeks.length };
    };
    const cur = build(current);
    const pri = build(prior);
    // The people behind the CURRENT period's total — same rows, capped for payload.
    const people = peopleForWeeks(current, personsByWeek).map((p) => ({
      name: p.name,
      company: p.company,
      propertyId: p.propertyId,
      amount: round2(p.amount),
    }));

    let reviewed = false;
    try {
      const r = await db
        .select({ id: weeklyReviewsTable.id })
        .from(weeklyReviewsTable)
        .where(eq(weeklyReviewsTable.periodKey, key))
        .limit(1);
      reviewed = r.length > 0;
    } catch {
      reviewed = false;
    }

    res.json({
      kind,
      periodKey: key,
      label,
      properties: activeProperties,
      current: { ...cur, properties: activeProperties },
      prior: pri,
      delta: {
        collected: round2(cur.collected - pri.collected),
        rent: round2(cur.rent - pri.rent),
        net: round2(cur.net - pri.net),
      },
      peopleCount: people.length,
      people: people.slice(0, 200),
      reviewed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/finance/week-diff?week=<saturday>  (default = current pay-week)
router.get("/finance/week-diff", async (req, res): Promise<void> => {
  try {
    const weekParam = String(req.query.week ?? "");
    const thisWeek =
      parsePayWeekDate(weekParam) && weekParam >= GO_LIVE ? weekParam : mostRecentSaturday();
    const td = parsePayWeekDate(thisWeek)!;
    const priorWeek = ymd(new Date(td.getFullYear(), td.getMonth(), td.getDate() - 7));

    type P = { personId: string; name: string; weekly: number };
    const thisMap = new Map<string, P>();
    const priorMap = new Map<string, P>();
    try {
      const buckets = await fetchHousingDeductionsByWeek(priorWeek, thisWeek);
      for (const b of buckets) {
        const target = b.payWeekEndDate === thisWeek ? thisMap : b.payWeekEndDate === priorWeek ? priorMap : null;
        if (!target) continue;
        for (const r of b.rows) {
          target.set(r.personId, { personId: r.personId, name: r.name, weekly: r.weekly });
        }
      }
    } catch (err) {
      logger.warn({ err }, "finance/week-diff: zenople fetch failed — returning empty diff");
      res.json({ week: thisWeek, prior: priorWeek, unavailable: true, counts: { new: 0, stopped: 0, changed: 0 }, added: [], stopped: [], changed: [] });
      return;
    }

    const added: P[] = [];
    const stopped: P[] = [];
    const changed: { personId: string; name: string; prior: number; current: number }[] = [];
    for (const [id, p] of thisMap) {
      const was = priorMap.get(id);
      if (!was) added.push(p);
      else if (round2(was.weekly) !== round2(p.weekly))
        changed.push({ personId: id, name: p.name, prior: round2(was.weekly), current: round2(p.weekly) });
    }
    for (const [id, p] of priorMap) {
      if (!thisMap.has(id)) stopped.push(p);
    }

    res.json({
      week: thisWeek,
      prior: priorWeek,
      counts: { new: added.length, stopped: stopped.length, changed: changed.length },
      added,
      stopped,
      changed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/finance/week-review  { periodKey, note? }  — idempotent on periodKey.
router.post("/finance/week-review", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { periodKey?: string; note?: string; reviewedBy?: string };
    const periodKey = (body.periodKey ?? "").trim();
    if (!periodKey) {
      res.status(400).json({ error: "periodKey is required" });
      return;
    }
    const row = {
      id: `wr-${periodKey}`,
      periodKey,
      reviewedAt: new Date(),
      reviewedBy: (body.reviewedBy ?? "").trim(),
      note: (body.note ?? "").trim(),
    };
    await db
      .insert(weeklyReviewsTable)
      .values(row)
      .onConflictDoUpdate({
        target: weeklyReviewsTable.periodKey,
        set: { reviewedAt: row.reviewedAt, note: row.note, reviewedBy: row.reviewedBy },
      });
    res.json({ periodKey, reviewed: true, reviewedAt: row.reviewedAt.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
