import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  occupantsTable,
  payrollDeductionsTable,
  bedsTable,
  propertiesTable,
} from "@workspace/db";
import { anthropic, ASSISTANT_MODEL, ASSISTANT_EFFORT } from "@workspace/integrations-anthropic-ai";
import { getOccupantDeductionsBatch } from "../lib/occupant-deduction";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Stage 3d — AI-assisted Zenople match suggestions.
// POST /api/zenople/match/suggest  { occupantId, candidates? }
// Returns ranked suggestions ONLY (no writes); a human confirms separately.
// ---------------------------------------------------------------------------

interface Candidate {
  zenoplePersonId: string;
  name: string;
  company: string;
}

interface Suggestion {
  zenoplePersonId: string;
  confidence: number;
  reasoning: string;
}

const norm = (s: string): string =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s*-\s*(t\d+|driver|lead)\b/gi, "") // trailing tags like "- T6"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function nameTokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((t) => t.length > 1));
}

/** Cheap token-overlap so we shortlist the plausible few, not the world. */
function overlap(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

async function gatherCandidates(occupant: {
  name: string;
  company: string;
}): Promise<Candidate[]> {
  // Distinct persons seen in payroll deductions (the Zenople-fed pool).
  const rows = await db
    .select({
      personId: payrollDeductionsTable.personId,
      name: payrollDeductionsTable.nameSnapshot,
      company: payrollDeductionsTable.customerSnapshot,
    })
    .from(payrollDeductionsTable);

  const byPerson = new Map<string, Candidate>();
  for (const r of rows) {
    if (!r.personId) continue;
    if (!byPerson.has(r.personId)) {
      byPerson.set(r.personId, {
        zenoplePersonId: r.personId,
        name: r.name ?? "",
        company: r.company ?? "",
      });
    }
  }

  const occCompany = norm(occupant.company);
  return [...byPerson.values()]
    .map((c) => ({
      c,
      score:
        overlap(occupant.name, c.name) +
        (occCompany && norm(c.company) === occCompany ? 0.25 : 0),
    }))
    .filter((x) => x.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((x) => x.c);
}

router.post("/zenople/match/suggest", async (req, res): Promise<void> => {
  try {
    const occupantId =
      typeof req.body?.occupantId === "string" ? req.body.occupantId : "";
    if (!occupantId) {
      res.status(400).json({ error: "occupantId is required" });
      return;
    }

    const [occupant] = await db
      .select({
        id: occupantsTable.id,
        name: occupantsTable.name,
        company: occupantsTable.company,
      })
      .from(occupantsTable)
      .where(eq(occupantsTable.id, occupantId));
    if (!occupant) {
      res.status(404).json({ error: "Occupant not found" });
      return;
    }

    const candidates: Candidate[] = Array.isArray(req.body?.candidates)
      ? (req.body.candidates as unknown[])
          .map((c) => {
            const o = c as Record<string, unknown>;
            return {
              zenoplePersonId: String(o.zenoplePersonId ?? ""),
              name: String(o.name ?? ""),
              company: String(o.company ?? ""),
            };
          })
          .filter((c) => c.zenoplePersonId)
      : await gatherCandidates(occupant);

    if (candidates.length === 0) {
      res.json({ occupantId, suggestions: [] as Suggestion[], candidatesConsidered: 0 });
      return;
    }

    const prompt = [
      "You match a housed associate to the correct Zenople payroll person.",
      "Return ONLY a strict JSON array, no prose, no code fences:",
      '[{"zenoplePersonId": string, "confidence": number 0-1, "reasoning": short string}]',
      "Only include candidates that plausibly match. Account for middle names/initials,",
      "suffixes (Jr/Sr/III), accents, name-order swaps, and trailing tags like '- T6'.",
      "",
      `ASSOCIATE: name="${occupant.name}" company="${occupant.company}"`,
      "CANDIDATES:",
      ...candidates.map(
        (c) => `- id=${c.zenoplePersonId} name="${c.name}" company="${c.company}"`,
      ),
    ].join("\n");

    const createParams = {
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    };
    (createParams as Record<string, unknown>).effort = ASSISTANT_EFFORT;

    let suggestions: Suggestion[] = [];
    try {
      const resp = await anthropic.messages.create(
        createParams as Parameters<typeof anthropic.messages.create>[0],
      );
      const textBlock = (
        resp as { content: Array<{ type: string; text?: string }> }
      ).content.find((b) => b.type === "text");
      const raw = (textBlock?.text ?? "").trim();
      const stripped = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const parsed: unknown = JSON.parse(stripped);
      const validIds = new Set(candidates.map((c) => c.zenoplePersonId));
      if (Array.isArray(parsed)) {
        suggestions = parsed
          .map((p) => {
            const o = (p ?? {}) as Record<string, unknown>;
            const id = String(o.zenoplePersonId ?? "");
            const confidence = Number(o.confidence);
            return {
              zenoplePersonId: id,
              confidence: Number.isFinite(confidence)
                ? Math.max(0, Math.min(1, confidence))
                : 0,
              reasoning: String(o.reasoning ?? "").slice(0, 280),
            };
          })
          .filter((s) => s.zenoplePersonId && validIds.has(s.zenoplePersonId))
          .sort((a, b) => b.confidence - a.confidence);
      }
    } catch (err) {
      // AI hiccup or bad JSON must not 500 the review queue — return the
      // shortlist with empty suggestions so the operator can still pick.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), occupantId },
        "Zenople match suggest: AI/JSON failure, returning empty suggestions",
      );
    }

    res.json({
      occupantId,
      suggestions,
      candidatesConsidered: candidates.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Stage 3e — "Not in payroll yet" tray.
// GET /api/zenople/unlinked
// Everyone housed (Active + in a bed) who is not linked OR has a $0 deduction,
// with the monthly rent we pay for their bed (highest-value leak first).
// ---------------------------------------------------------------------------

router.get("/zenople/unlinked", async (_req, res): Promise<void> => {
  try {
    const occupants = await db
      .select({
        id: occupantsTable.id,
        name: occupantsTable.name,
        company: occupantsTable.company,
        bedId: occupantsTable.bedId,
        propertyId: occupantsTable.propertyId,
        status: occupantsTable.status,
        zenopleStatus: occupantsTable.zenopleStatus,
      })
      .from(occupantsTable);

    const housed = occupants.filter(
      (o) => o.status === "Active" && o.bedId,
    );

    const deductions = await getOccupantDeductionsBatch(housed.map((o) => o.id));

    // Per-property monthly rent we pay + bed counts -> rent per bed.
    const props = await db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        monthlyRent: propertiesTable.monthlyRent,
      })
      .from(propertiesTable);
    const propById = new Map(props.map((p) => [p.id, p]));

    const beds = await db
      .select({ id: bedsTable.id, propertyId: bedsTable.propertyId })
      .from(bedsTable);
    const bedCount = new Map<string, number>();
    for (const b of beds) {
      bedCount.set(b.propertyId, (bedCount.get(b.propertyId) ?? 0) + 1);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const rows = housed
      .map((o) => {
        const ded = deductions.get(o.id);
        const weekly = ded?.weeklyAmount ?? 0;
        const isLinked = o.zenopleStatus === "linked";
        if (isLinked && weekly > 0) return null; // recovered — not a leak
        const prop = o.propertyId ? propById.get(o.propertyId) : undefined;
        const bedsInProp = o.propertyId ? bedCount.get(o.propertyId) ?? 0 : 0;
        const rentPerBed =
          prop && bedsInProp > 0
            ? round2((prop.monthlyRent || 0) / bedsInProp)
            : 0;
        return {
          occupantId: o.id,
          name: o.name,
          company: o.company,
          propertyId: o.propertyId ?? "",
          propertyName: prop?.name ?? "",
          bedId: o.bedId ?? "",
          zenopleStatus: o.zenopleStatus ?? "pending",
          weeklyDeduction: weekly,
          monthlyRentWePay: rentPerBed,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.monthlyRentWePay - a.monthlyRentWePay);

    const totalMonthlyAtRisk = round2(
      rows.reduce((s, r) => s + r.monthlyRentWePay, 0),
    );

    res.json({ count: rows.length, totalMonthlyAtRisk, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
