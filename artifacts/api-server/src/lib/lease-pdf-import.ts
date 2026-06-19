import { z } from "zod";
import {
  anthropic,
  ASSISTANT_MODEL,
  EXTRACTION_EFFORT,
} from "@workspace/integrations-anthropic-ai";
import type { PropertyRow, CustomerRow } from "@workspace/db";
import {
  normalizeLeaseRow,
  type NormalizerFixup,
} from "./db-row-normalizers";

/**
 * One coercion the boundary normaliser applied while preparing the
 * extracted lease for the operator-facing review dialog (Task #372).
 * `field` is prefixed with the target table (`lease.startDate`, …)
 * so the operator can tell which extracted value was rewritten before
 * it would land in the DB.
 */
export interface LeasePdfFixup {
  field: string;
  before: string;
  after: string;
}

/** Public return shape of `extractLeaseFromText`. */
export interface ExtractLeaseResult {
  extracted: ExtractedLease;
  /**
   * Fix-ups the boundary normaliser would apply when this extracted
   * lease is committed to the DB. Empty when the LLM extraction
   * already matched the canonical contract — which is the common case
   * because `ExtractedLeaseSchema` validates dates with a strict
   * regex. The plumbing is in place so future stricter columns
   * (e.g. an enum on rate type) automatically surface coercions to
   * the operator at import time rather than silently in the DB.
   */
  fixups: LeasePdfFixup[];
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

const DateOrNull = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
  .transform((v) => (v === "" ? null : v));

// What we ask Claude to return. We keep it strict so a malformed answer
// produces a 502 instead of silently corrupting the review dialog.
export const ExtractedLeaseSchema = z.object({
  propertyName: z.string().nullable(),
  propertyAddress: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  landlordName: z.string().nullable(),
  startDate: DateOrNull,
  endDate: DateOrNull,
  monthlyRent: z.number().nullable(),
  securityDeposit: z.number().nullable(),
  notes: z.string(),
  // Extended fields surfaced on the lease detail page (clauses tab, buyout
  // option). Default to empty / false / null when the PDF doesn't mention
  // them so the reviewer dialog gets a stable shape.
  clauses: z.string().default(""),
  buyoutAvailable: z.boolean().default(false),
  buyoutCost: z.number().nullable().default(null),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ExtractedLease = z.infer<typeof ExtractedLeaseSchema>;

const SYSTEM_PROMPT = `You extract structured lease information from raw text
that was pulled from a single residential or commercial lease PDF.

Return ONLY a JSON object that exactly matches this TypeScript shape — no
markdown fences, no commentary:

{
  "propertyName":     string | null,  // e.g. "Maple Court Apartments" or null
  "propertyAddress":  string | null,  // street line only
  "city":             string | null,
  "state":            string | null,  // 2-letter US state if obvious, else full name, else null
  "zip":              string | null,
  "landlordName":     string | null,  // landlord / lessor / property owner name
  "startDate":        string | null,  // "YYYY-MM-DD" or null if not parseable
  "endDate":          string | null,  // "YYYY-MM-DD" or null if not parseable
  "monthlyRent":      number | null,  // in USD, no currency symbol
  "securityDeposit":  number | null,  // in USD
  "notes":            string,         // 1-3 short sentences summarising notable lease terms; "" if nothing notable
  "clauses":          string,         // notable lease clauses worth surfacing for the operator (see rules)
  "buyoutAvailable":  boolean,        // true only when an early-termination buyout is explicitly available
  "buyoutCost":       number | null,  // flat USD buyout fee when stated, else null
  "confidence":       "high" | "medium" | "low"
}

Rules:
- Use null (not 0, not "") when a numeric/date field is missing or ambiguous.
- Dates MUST be ISO YYYY-MM-DD. Reject partial dates ("June 2026") by returning null.
- Rent and deposit must be plain numbers, not strings.
- "clauses" is a human-readable summary of notable clauses (pet policy,
  smoking, subletting, late fees, parking, maintenance responsibilities,
  early termination, renewal, guests, alterations, etc.). Separate
  individual clauses with blank lines. Use "" if the lease has nothing
  beyond boilerplate worth flagging. Do NOT copy the entire lease verbatim.
- "buyoutAvailable" is true ONLY when the lease explicitly grants the
  tenant the option to terminate early by paying a defined fee
  (sometimes called "buyout", "lease break fee", "early termination fee").
  A clause that merely lists damages for breach does not count.
- "buyoutCost" is the flat dollar buyout fee (plain number, no $).
  Use null if the cost is variable, missing, or buyoutAvailable is false.
- "confidence" reflects your overall confidence in the lease being parseable.
  Use "low" if more than half the core fields (dates / rent / property)
  are null.
- Output JSON only.`;

export async function extractLeaseFromText(
  text: string,
): Promise<ExtractLeaseResult> {
  // Guard against absurdly long PDFs — Claude can take 200k tokens but
  // there is no need to send a whole novel. ~20k chars is plenty for any
  // real-world residential lease.
  const trimmed = text.length > 20_000 ? text.slice(0, 20_000) : text;

  return extractLeaseFromMessages([
    {
      role: "user",
      content: `Lease PDF text:\n\n${trimmed}`,
    },
  ]);
}

/**
 * Vision/OCR fallback: send the raw PDF bytes to Claude as a document
 * attachment so it can read scanned/image-only leases that pdf-parse
 * can't extract text from. Claude handles OCR internally.
 */
export async function extractLeaseFromPdfBuffer(
  pdfBuffer: Buffer | Uint8Array,
): Promise<ExtractLeaseResult> {
  const base64 = Buffer.from(pdfBuffer).toString("base64");
  return extractLeaseFromMessages([
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        },
        {
          type: "text",
          text:
            "This lease PDF is image-only (scanned). Read the pages, OCR " +
            "the text, and extract the lease fields per the JSON schema.",
        },
      ],
    },
  ]);
}

async function extractLeaseFromMessages(
  messages: Parameters<typeof anthropic.messages.create>[0]["messages"],
): Promise<ExtractLeaseResult> {
  // Lease-PDF extraction is a narrow structured-output task → LOW reasoning
  // effort to stay cheap/fast (the interactive assistant uses HIGH). We keep
  // the params object as a clean NON-streaming literal (no `stream`, no
  // `effort` in its static type) so the create() overload still resolves to
  // the `Message` return — that's what makes `resp.content` typed below.
  // `effort` (supported by Opus 4.8 but not yet in @anthropic-ai/sdk ^0.78.0
  // types) is attached at runtime only; confirm the field name on Replit.
  const createParams = {
    model: ASSISTANT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages,
  };
  (createParams as Record<string, unknown>).effort = EXTRACTION_EFFORT;
  const resp = await anthropic.messages.create(createParams);

  // Pull the first text block.
  const textBlock = resp.content.find(
    (b): b is Extract<typeof resp.content[number], { type: "text" }> =>
      b.type === "text",
  );
  if (!textBlock) {
    throw new Error("LLM returned no text block");
  }
  const raw = textBlock.text.trim();

  // Tolerate code fences if Claude adds them despite the system prompt.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `LLM returned invalid JSON: ${(err as Error).message}\n--- raw ---\n${raw.slice(0, 400)}`,
    );
  }

  const result = ExtractedLeaseSchema.parse(parsed);

  // Keep buyout fields internally consistent — if the lease isn't a buyout
  // lease, the cost is meaningless. The reviewer dialog mirrors this same
  // invariant (clears the cost when the toggle goes off), so we apply it
  // here too rather than relying on the LLM to be perfectly consistent.
  if (!result.buyoutAvailable) {
    result.buyoutCost = null;
  }

  // Run the boundary normaliser over the projection of the extracted
  // lease that would actually be written to the DB, and surface any
  // resulting fix-ups so the operator sees them in the review dialog
  // — not silently after the row lands in the DB (Task #372).
  const normFixups: NormalizerFixup[] = [];
  normalizeLeaseRow(
    {
      startDate: result.startDate ?? "",
      endDate: result.endDate ?? "",
    },
    normFixups,
  );
  const fixups: LeasePdfFixup[] = normFixups.map((f) => ({
    field: `lease.${f.field}`,
    before: f.before,
    after: f.after,
  }));

  return { extracted: result, fixups };
}

// ---------------------------------------------------------------------------
// Property fuzzy matching
// ---------------------------------------------------------------------------

export type PropertyCandidate = {
  propertyId: string;
  propertyName: string;
  address: string;
  city: string;
  state: string;
  customerName: string;
  score: number;
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s: string | null | undefined): Set<string> {
  const norm = normalize(s);
  if (!norm) return new Set();
  // Drop very short / generic tokens that match too many properties.
  const STOP = new Set(["the", "and", "of", "st", "rd", "ave", "dr", "ln", "ct", "pl", "blvd", "apt", "unit", "suite", "ste"]);
  return new Set(norm.split(" ").filter((t) => t.length >= 2 && !STOP.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function rankPropertyCandidates(
  extracted: ExtractedLease,
  properties: PropertyRow[],
  customers: CustomerRow[],
): PropertyCandidate[] {
  const customerById = new Map(customers.map((c) => [c.id, c.name]));

  const queryNameTokens = tokenize(extracted.propertyName);
  const queryAddrTokens = tokenize(
    [extracted.propertyAddress, extracted.city, extracted.state, extracted.zip]
      .filter(Boolean)
      .join(" "),
  );
  const queryZip = normalize(extracted.zip);

  const scored = properties.map((p) => {
    const propNameTokens = tokenize(p.name);
    const propAddrTokens = tokenize(`${p.address} ${p.city} ${p.state} ${p.zip}`);

    // Weighted blend: address is the strongest signal because property
    // names in this app are often nicknames ("West House") that won't
    // appear verbatim in the lease.
    const nameScore = jaccard(queryNameTokens, propNameTokens);
    const addrScore = jaccard(queryAddrTokens, propAddrTokens);
    let score = nameScore * 0.35 + addrScore * 0.65;

    // Big bump for an exact ZIP match — leases almost always carry the
    // canonical 5-digit ZIP and it disambiguates same-street properties.
    if (queryZip && normalize(p.zip) === queryZip) {
      score = Math.min(1, score + 0.15);
    }

    return {
      propertyId: p.id,
      propertyName: p.name,
      address: p.address,
      city: p.city,
      state: p.state,
      customerName: customerById.get(p.customerId) ?? "",
      score: Number(score.toFixed(3)),
    };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
