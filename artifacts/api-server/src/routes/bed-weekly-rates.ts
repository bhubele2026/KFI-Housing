import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, bedsTable, bedWeeklyRatesTable } from "@workspace/db";
import { isSaturdayDate } from "../lib/pay-week";

// Per-bed "current weekly rate" CRUD (Task #598). Rates roll
// forward week-by-week: the rate effective for any pay-week W is
// the latest row whose `effectivePayWeekEndDate` is ≤ W. There is
// no "end date" field — entering a new row supersedes the prior
// one from its effective Saturday onward, mirroring the way the
// operator team already reasons about rate changes.
//
// `(bedId, effectivePayWeekEndDate)` is unique on the table so
// re-saving the same Saturday overwrites the row in place; the
// POST handler uses an INSERT … ON CONFLICT DO UPDATE to keep
// that semantics atomic without a read-then-write race.

const router: IRouter = Router();

const PostBody = z.object({
  effectivePayWeekEndDate: z.string().refine(isSaturdayDate, {
    message: "effectivePayWeekEndDate must be a Saturday YYYY-MM-DD",
  }),
  weeklyRate: z.number().nonnegative(),
  note: z.string().max(500).optional(),
});

function newId(bedId: string, week: string): string {
  // Deterministic id so duplicate POSTs land on the same row
  // (the unique index would reject otherwise). Bed id is already
  // slug-safe in this codebase.
  return `bwr_${bedId}_${week}`;
}

async function ensureBedExists(bedId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: bedsTable.id })
    .from(bedsTable)
    .where(eq(bedsTable.id, bedId));
  return Boolean(row);
}

router.get("/beds/:id/weekly-rates", async (req, res): Promise<void> => {
  const bedId = req.params.id;
  if (!(await ensureBedExists(bedId))) {
    res.status(404).json({ error: "Bed not found" });
    return;
  }
  const rows = await db
    .select()
    .from(bedWeeklyRatesTable)
    .where(eq(bedWeeklyRatesTable.bedId, bedId))
    .orderBy(desc(bedWeeklyRatesTable.effectivePayWeekEndDate));
  res.json(rows);
});

router.post("/beds/:id/weekly-rates", async (req, res): Promise<void> => {
  const bedId = req.params.id;
  if (!(await ensureBedExists(bedId))) {
    res.status(404).json({ error: "Bed not found" });
    return;
  }
  const parsed = PostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { effectivePayWeekEndDate, weeklyRate, note } = parsed.data;
  const id = newId(bedId, effectivePayWeekEndDate);
  const [row] = await db
    .insert(bedWeeklyRatesTable)
    .values({
      id,
      bedId,
      effectivePayWeekEndDate,
      weeklyRate,
      source: "manual",
      note: note ?? "",
    })
    .onConflictDoUpdate({
      target: [
        bedWeeklyRatesTable.bedId,
        bedWeeklyRatesTable.effectivePayWeekEndDate,
      ],
      set: { weeklyRate, note: note ?? "", source: "manual" },
    })
    .returning();
  res.status(201).json(row);
});

router.delete(
  "/beds/:id/weekly-rates/:rateId",
  async (req, res): Promise<void> => {
    const { id: bedId, rateId } = req.params;
    const result = await db
      .delete(bedWeeklyRatesTable)
      .where(
        and(
          eq(bedWeeklyRatesTable.id, rateId),
          eq(bedWeeklyRatesTable.bedId, bedId),
        ),
      )
      .returning({ id: bedWeeklyRatesTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Rate entry not found" });
      return;
    }
    res.sendStatus(204);
  },
);

/**
 * Group all rate rows by bed id and pre-sort each list ascending
 * by effective Saturday. The finance rollup uses this to do a
 * cheap O(log n) per-week lookup without re-querying the DB once
 * per bed × week.
 */
export function groupRatesByBed(
  rows: { bedId: string; effectivePayWeekEndDate: string; weeklyRate: number }[],
): Map<string, { effectivePayWeekEndDate: string; weeklyRate: number }[]> {
  const m = new Map<
    string,
    { effectivePayWeekEndDate: string; weeklyRate: number }[]
  >();
  for (const r of rows) {
    const list = m.get(r.bedId) ?? [];
    list.push({
      effectivePayWeekEndDate: r.effectivePayWeekEndDate,
      weeklyRate: r.weeklyRate,
    });
    m.set(r.bedId, list);
  }
  for (const [, list] of m) {
    list.sort((a, b) =>
      a.effectivePayWeekEndDate.localeCompare(b.effectivePayWeekEndDate),
    );
  }
  return m;
}

/**
 * Effective rate for a single bed at a given pay-week. Returns 0
 * when no rate has been entered yet (matches the "clean slate"
 * semantics from Task #598 — chargePerBed was zeroed out so the
 * absence of a rate row genuinely means $0, not "unknown").
 */
export function effectiveBedWeeklyRate(
  history: { effectivePayWeekEndDate: string; weeklyRate: number }[] | undefined,
  payWeekEndDate: string,
): number {
  if (!history || history.length === 0) return 0;
  // history is sorted ascending; walk backwards to find the most
  // recent row whose effective date is ≤ the requested week.
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].effectivePayWeekEndDate <= payWeekEndDate) {
      return history[i].weeklyRate;
    }
  }
  return 0;
}

export default router;
