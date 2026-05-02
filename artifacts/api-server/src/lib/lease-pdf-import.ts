import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { PropertyRow, CustomerRow } from "@workspace/db";

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
  "confidence":       "high" | "medium" | "low"
}

Rules:
- Use null (not 0, not "") when a field is missing or ambiguous.
- Dates MUST be ISO YYYY-MM-DD. Reject partial dates ("June 2026") by returning null.
- Rent and deposit must be plain numbers, not strings.
- "confidence" reflects your overall confidence in the lease being parseable.
  Use "low" if more than half the fields are null.
- Output JSON only.`;

export async function extractLeaseFromText(text: string): Promise<ExtractedLease> {
  // Guard against absurdly long PDFs — Claude can take 200k tokens but
  // there is no need to send a whole novel. ~20k chars is plenty for any
  // real-world residential lease.
  const trimmed = text.length > 20_000 ? text.slice(0, 20_000) : text;

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Lease PDF text:\n\n${trimmed}`,
      },
    ],
  });

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

  return ExtractedLeaseSchema.parse(parsed);
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
