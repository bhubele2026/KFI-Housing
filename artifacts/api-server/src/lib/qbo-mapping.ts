import type {
  CustomerRow,
  LeaseRow,
  PropertyRow,
  UtilityRow,
  QboAccountClassificationRow,
  QboClassification,
  QboMappingOverrideRow,
} from "@workspace/db";
import { rankPropertyCandidates } from "./lease-pdf-import";

/**
 * Pure-function mapping helpers for the QBO sync pipeline
 * (Task #689). Each function takes plain data in and returns plain
 * data out — no DB calls — so the unit tests don't need fixtures.
 */

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reduce a free-form QBO memo / line description to a stable token we
 * can key mapping-overrides on. Drops generic words ("rent", "invoice",
 * "payment", month names, year numbers) so an override learned in
 * January still matches the February memo on the same property.
 */
const MEMO_STOP = new Set([
  "rent",
  "invoice",
  "payment",
  "for",
  "of",
  "the",
  "and",
  "to",
  "monthly",
  "lease",
  "utilities",
  "utility",
  "bill",
]);
const MONTHS = new Set([
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

export function memoToken(memo: string | null | undefined): string {
  const n = norm(memo);
  if (!n) return "";
  const toks = n.split(" ").filter((t) => {
    if (t.length < 2) return false;
    if (MEMO_STOP.has(t)) return false;
    if (MONTHS.has(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return true;
  });
  toks.sort();
  return toks.slice(0, 6).join(" ");
}

// ---------------------------------------------------------------------------
// Customer matching
// ---------------------------------------------------------------------------

export interface MatchCustomerResult {
  customerId: string | null;
  confidence: number;
}

/**
 * Match a QBO customer to a HousingOps customer.
 *
 * Priority:
 *   1. Exact `qboCustomerId` match on `customers.qboCustomerId` → 1.0
 *   2. Exact name match (case-insensitive, normalised) → 0.9
 *   3. Fuzzy name (jaccard token overlap) above 0.5 threshold
 */
export function matchCustomer(
  qboCustomer: { id: string; displayName: string },
  customers: CustomerRow[],
): MatchCustomerResult {
  const direct = customers.find((c) => c.qboCustomerId === qboCustomer.id);
  if (direct) return { customerId: direct.id, confidence: 1 };
  const qName = norm(qboCustomer.displayName);
  if (!qName) return { customerId: null, confidence: 0 };
  const exact = customers.find((c) => norm(c.name) === qName);
  if (exact) return { customerId: exact.id, confidence: 0.9 };
  // Fuzzy fallback (jaccard).
  const qTokens = new Set(qName.split(" ").filter((t) => t.length >= 2));
  let best: { id: string; score: number } | null = null;
  for (const c of customers) {
    const t = new Set(
      norm(c.name)
        .split(" ")
        .filter((x) => x.length >= 2),
    );
    if (qTokens.size === 0 || t.size === 0) continue;
    let inter = 0;
    for (const x of qTokens) if (t.has(x)) inter += 1;
    const union = qTokens.size + t.size - inter;
    const score = union === 0 ? 0 : inter / union;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  if (best && best.score >= 0.5) {
    return { customerId: best.id, confidence: Number(best.score.toFixed(3)) };
  }
  return { customerId: null, confidence: best?.score ?? 0 };
}

// ---------------------------------------------------------------------------
// Property matching
// ---------------------------------------------------------------------------

export interface MatchPropertyResult {
  propertyId: string | null;
  confidence: number;
}

/**
 * Map a QBO memo / line description to a HousingOps property using
 * the same scorer that the lease-PDF importer uses (`rankPropertyCandidates`).
 * Confidence below 0.6 returns `null` so the caller leaves
 * `propertyId IS NULL` and the row falls into the Needs-mapping tray.
 */
export function matchPropertyFromMemo(
  memoText: string,
  properties: PropertyRow[],
  customers: CustomerRow[],
): MatchPropertyResult {
  if (!memoText.trim()) return { propertyId: null, confidence: 0 };
  // Reuse the ranker by stuffing the memo text into both the
  // propertyName and propertyAddress fields — the ranker tokenises
  // them with the same algorithm we want for memo text.
  const candidates = rankPropertyCandidates(
    {
      propertyName: memoText,
      propertyAddress: memoText,
      city: null,
      state: null,
      zip: null,
      landlordName: null,
      startDate: null,
      endDate: null,
      monthlyRent: null,
      securityDeposit: null,
      notes: "",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
      confidence: "low",
    },
    properties,
    customers,
  );
  const top = candidates[0];
  if (!top) return { propertyId: null, confidence: 0 };
  if (top.score < 0.6) {
    return { propertyId: null, confidence: top.score };
  }
  return { propertyId: top.propertyId, confidence: top.score };
}

// ---------------------------------------------------------------------------
// Account classification
// ---------------------------------------------------------------------------

const RENT_ACCOUNT_TOKENS = ["rent expense", "rent"];
const UTILITY_ACCOUNT_TOKENS = [
  "utilities",
  "utility",
  "water",
  "electric",
  "gas",
  "trash",
  "garbage",
  "sewer",
  "internet",
  "wifi",
];

/**
 * Classify a QBO chart-of-accounts entry as rent / utility / other.
 * Operator-edited overrides in `qbo_account_classifications` win.
 */
export function classifyAccount(
  accountName: string,
  accountId: string,
  classifications: QboAccountClassificationRow[],
): QboClassification {
  const a = norm(accountName);
  const override =
    classifications.find(
      (c) =>
        (c.qboAccountId && c.qboAccountId === accountId) ||
        (c.accountName && norm(c.accountName) === a),
    ) ?? null;
  if (override) return override.classification as QboClassification;
  if (UTILITY_ACCOUNT_TOKENS.some((t) => a.includes(t))) return "utility";
  if (RENT_ACCOUNT_TOKENS.some((t) => a.includes(t))) return "rent";
  return "other";
}

// ---------------------------------------------------------------------------
// Lease / utility row picking
// ---------------------------------------------------------------------------

/**
 * Pick the most-recent active lease covering the txn date for a
 * "rent" classified transaction. When `txnDate` is empty or no lease
 * spans it, falls back to the most recently started active lease on
 * the property.
 */
export function pickLeaseForRent(
  propertyId: string,
  txnDate: string,
  leases: LeaseRow[],
): string | null {
  const onProp = leases.filter((l) => l.propertyId === propertyId);
  if (onProp.length === 0) return null;
  const active = onProp.filter((l) => (l.status ?? "").toLowerCase() === "active");
  const pool = active.length > 0 ? active : onProp;
  if (txnDate) {
    const covering = pool.filter((l) => {
      const s = l.startDate || "";
      const e = l.endDate || "9999-12-31";
      return (!s || s <= txnDate) && (!e || e >= txnDate);
    });
    if (covering.length > 0) {
      covering.sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
      return covering[0].id;
    }
  }
  const sorted = [...pool].sort((a, b) =>
    (b.startDate || "").localeCompare(a.startDate || ""),
  );
  return sorted[0]?.id ?? null;
}

/**
 * Pick the most-likely `utilities` row for a "utility" classified
 * transaction. Token-matches on the well-known utility types.
 */
export function pickUtilityForUtility(
  propertyId: string,
  memoText: string,
  accountName: string,
  utilities: UtilityRow[],
): string | null {
  const onProp = utilities.filter((u) => u.propertyId === propertyId);
  if (onProp.length === 0) return null;
  const haystack = norm(`${memoText} ${accountName}`);
  if (!haystack) return onProp[0]?.id ?? null;
  // Order matters — match more specific tokens first.
  const TOKEN_ORDER: Array<[string, RegExp]> = [
    ["water", /\bwater\b|\bsewer\b/],
    ["electric", /\belectric|\bpower\b/],
    ["gas", /\bgas\b/],
    ["trash", /\btrash\b|\bgarbage\b/],
    ["internet", /\binternet\b|\bwifi\b|\bcable\b/],
  ];
  for (const [token, re] of TOKEN_ORDER) {
    if (!re.test(haystack)) continue;
    const hit = onProp.find((u) => {
      const tt = norm(u.type);
      return tt === token || tt.includes(token);
    });
    if (hit) return hit.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Override lookup
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Memo-token n-gram suggestion (Task #694 — "Save as rule…" affordance)
// ---------------------------------------------------------------------------

const SUGGEST_STOP = new Set([
  ...MEMO_STOP,
  ...MONTHS,
  "the",
  "a",
  "an",
  "from",
  "with",
  "by",
  "on",
  "in",
  "at",
  "no",
  "ref",
  "amt",
]);

function suggestTokens(memo: string): string[] {
  const n = norm(memo);
  if (!n) return [];
  return n
    .split(" ")
    .filter((t) => {
      if (t.length < 2) return false;
      if (SUGGEST_STOP.has(t)) return false;
      // Skip numbers, dates (YYYY-MM-DD style is already split on dashes
      // by `norm`, so individual numeric tokens drop here).
      if (/^\d+$/.test(t)) return false;
      return true;
    });
}

/**
 * Pick a stable "memo contains" token to seed the Save-as-rule flow.
 *
 * Deterministic heuristic (no model calls):
 *   1. Tokenise `memo` and every other unmapped memo from the same
 *      customer; drop generic stop-words, months, and pure numbers.
 *   2. Find the longest contiguous 2–4 word n-gram in `memo` that also
 *      appears in at least one other unmapped memo — that shared
 *      phrase is the strongest "this is the same kind of charge"
 *      signal we can get without an LLM.
 *   3. If no overlap, fall back to the first 3 non-stop tokens of the
 *      memo so the dialog still has *something* to pre-fill.
 *   4. If the memo itself has no usable tokens, return an empty string
 *      so the operator types the rule from scratch.
 */
export function suggestMemoToken(
  memo: string,
  otherUnmappedMemos: string[],
): string {
  const tokens = suggestTokens(memo);
  if (tokens.length === 0) return "";
  const others = otherUnmappedMemos
    .map((m) => suggestTokens(m).join(" "))
    .filter(Boolean);
  // Walk n-gram widths 4 → 2 so the LONGEST shared phrase wins.
  for (const width of [4, 3, 2]) {
    if (tokens.length < width) continue;
    for (let i = 0; i + width <= tokens.length; i += 1) {
      const phrase = tokens.slice(i, i + width).join(" ");
      if (others.some((o) => o.includes(phrase))) return phrase;
    }
  }
  // No overlap — fall back to the first 3 (or fewer) tokens.
  return tokens.slice(0, 3).join(" ");
}

export function findOverride(
  realmId: string,
  qboCustomerId: string,
  qboVendorId: string,
  memo: string,
  overrides: QboMappingOverrideRow[],
): QboMappingOverrideRow | null {
  const tok = memoToken(memo);
  // Match on the *populated* counterparty dimension. Bill-side rows
  // carry no customer id and customer-side rows carry no vendor id;
  // we don't want a vendor-side override to spuriously match a
  // customer-side row just because both have an empty `qboVendorId`.
  return (
    overrides.find((o) => {
      if (o.realmId !== realmId) return false;
      if (o.memoToken !== tok) return false;
      // Both dimensions must agree on whatever is populated; empty
      // strings only match other empty strings on the same side.
      const customerMatches =
        (o.qboCustomerId ?? "") === (qboCustomerId ?? "");
      const vendorMatches = (o.qboVendorId ?? "") === (qboVendorId ?? "");
      if (!customerMatches || !vendorMatches) return false;
      // At least one counterparty id must be non-empty so a "blank /
      // blank" pair can't collide across the dataset.
      return Boolean(qboCustomerId || qboVendorId);
    }) ?? null
  );
}
