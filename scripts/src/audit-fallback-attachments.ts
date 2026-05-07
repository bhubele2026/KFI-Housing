// Task #328 audit script.
//
// Sweeps the HousingOps database for any property currently attached to
// a "fallback-like" customer (KFI Staffing — <city>, Unknown, TBD,
// Placeholder, etc.) and reports — per property — whether the master
// file (encoded in the seed-side registry below) identifies a real
// downstream end-client we could repoint to.
//
// Two layers of coverage:
//   1. Wide sweep: every customer whose name matches a known
//      fallback-like LIKE pattern, joined to its properties. This
//      catches operator-created rows the seed registry doesn't know
//      about — exactly the case the reviewer flagged.
//   2. Seed registry: for properties managed by a Task #328 seed, the
//      script also looks up the seed's expected real end-client pattern
//      and tells you whether the auto-repoint can already fire on the
//      next api-server restart, or whether the master-file end-client
//      still needs to be imported.
//
// Read-only — performs only `SELECT`s and is safe to run against any
// database.
//
// Usage:
//   pnpm --filter @workspace/scripts run audit:fallback-attachments
//   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts \
//       run audit:fallback-attachments

import { like, inArray, or } from "drizzle-orm";

interface SeedFallbackEntry {
  /** Human-readable seed name. */
  seed: string;
  /** Property id this seed manages. */
  propertyId: string;
  /** Deterministic fallback customer id this seed creates on first boot. */
  fallbackCustomerId: string;
  /** SQL LIKE pattern of the real downstream end-client (master file). */
  endClientNamePattern: string | null;
  /** Notes / source citation in the master file. */
  notes: string;
}

// Source of truth: every entry's `propertyId` and `fallbackCustomerId`
// MUST match the canonical exported constants
// (`<SEED>_PROPERTY_ID` / `<SEED>_CUSTOMER_ID`) in the corresponding
// `artifacts/api-server/src/lib/seed-*.ts`. The drift guard in
// `audit-fallback-attachments.test.ts` parses those modules and asserts
// equality so this table cannot silently rot.
export const SEED_FALLBACKS: readonly SeedFallbackEntry[] = [
  {
    seed: "chateau-knoll",
    propertyId: "prop-chateau-knoll-bettendorf",
    fallbackCustomerId: "cust-kfi-corporate",
    endClientNamePattern: "Greystone Manufacturing%",
    notes: "Master file pins Chateau Knoll units to Greystone (Bettendorf, IA).",
  },
  {
    seed: "patriot-baraboo",
    propertyId: "prop-patriot-baraboo-1850-pine",
    fallbackCustomerId: "cust-kfi-baraboo",
    endClientNamePattern: "Milwaukee Valve%",
    notes: "Master file row 3 → Milwaukee Valve - Prairie du Sac, WI.",
  },
  {
    seed: "kolbe-wausau",
    propertyId: "prop-kolbe-wausau-s-8th-ave",
    fallbackCustomerId: "cust-kfi-wausau",
    endClientNamePattern: "Schuette Metals%",
    notes: "Master file row 9 → Schuette Metals - Rothschild, WI.",
  },
  {
    seed: "greenock-manor",
    propertyId: "prop-greenock-manor-mckeesport",
    fallbackCustomerId: "cust-kfi-greenock-manor",
    endClientNamePattern: "Shuster's%",
    notes: "Master file row 30 → Shuster's - Irwin, PA (units 32/36/42/48/49/52).",
  },
  {
    seed: "hickory-haven",
    propertyId: "prop-hickory-haven-600-hickory",
    fallbackCustomerId: "cust-kfi-hickory-haven",
    endClientNamePattern: "WB Manufactoring%",
    notes:
      "Master file row 8 → WB Manufactoring - Thorp, WI (sic; typo preserved verbatim from source).",
  },
  {
    seed: "park-place",
    propertyId: "prop-park-place-plymouth",
    fallbackCustomerId: "cust-kfi-park-place",
    endClientNamePattern: "Cardinal CG at Spring Green%",
    notes:
      "Master file row 1 → Cardinal CG at Spring Green, WI (NOT 'Cardinal CG - Northfield').",
  },
];

/**
 * Customer-name LIKE patterns considered "fallback-like" — the audit
 * sweep flags every property attached to a customer matching any of
 * these. Add more here (e.g. specific operator-introduced placeholders)
 * as they are discovered.
 */
export const FALLBACK_NAME_PATTERNS: readonly string[] = [
  "KFI Staffing%",
  "Unknown%",
  "TBD%",
  "Placeholder%",
  "%(placeholder)%",
  "%TBD%",
];

interface CustomerRow {
  id: string;
  name: string;
}
interface PropertyRow {
  id: string;
  customerId: string;
  name: string | null;
}

export interface QueryDeps {
  /**
   * Find every customer whose name matches any of the given LIKE
   * patterns (case-insensitive at the SQL level via ILIKE if the
   * adapter supports it; we use plain LIKE for portability).
   */
  findFallbackCustomers: (patterns: readonly string[]) => Promise<CustomerRow[]>;
  /** All properties whose customer_id is in the given set. */
  findPropertiesForCustomers: (
    customerIds: readonly string[],
  ) => Promise<PropertyRow[]>;
  /** First customer matching the given LIKE pattern (real end-client lookup). */
  findEndClientByPattern: (pattern: string) => Promise<CustomerRow | null>;
}

export interface AuditDeps extends QueryDeps {
  log?: (msg: string) => void;
}

export interface AuditRow {
  /** Seed id if this property is one of the registry seeds; else null. */
  seed: string | null;
  propertyId: string;
  propertyName: string | null;
  currentCustomerId: string;
  currentCustomerName: string;
  /** Which fallback pattern the customer matched (`null` if not fallback). */
  matchedFallbackPattern: string | null;
  /** Real end-client LIKE pattern from the seed registry, if known. */
  endClientNamePattern: string | null;
  /** True when an `endClientNamePattern` lookup found a real customer. */
  endClientFound: boolean;
  recommendation: string;
}

function classifyFallback(name: string): string | null {
  for (const pattern of FALLBACK_NAME_PATTERNS) {
    const re = new RegExp(
      "^" +
        pattern
          .split("%")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
      "i",
    );
    if (re.test(name)) return pattern;
  }
  return null;
}

export async function auditFallbackAttachments(
  deps: AuditDeps,
): Promise<AuditRow[]> {
  const seedByPropertyId = new Map<string, SeedFallbackEntry>();
  for (const entry of SEED_FALLBACKS) seedByPropertyId.set(entry.propertyId, entry);

  // 1) Wide sweep: pull every customer whose name looks fallback-like,
  //    then every property attached to one of them.
  const fallbackCustomers = await deps.findFallbackCustomers(FALLBACK_NAME_PATTERNS);
  const fallbackById = new Map<string, CustomerRow>();
  for (const c of fallbackCustomers) fallbackById.set(c.id, c);

  const properties = await deps.findPropertiesForCustomers(
    Array.from(fallbackById.keys()),
  );

  // Track which seed-registry properties were already covered by the
  // sweep so we can also report seed properties that exist in the DB but
  // are NOT attached to a fallback (i.e. already healed).
  const seenPropertyIds = new Set<string>();

  // Cache end-client lookups to avoid duplicate queries when multiple
  // seeds share a pattern (none today, but cheap to be safe).
  const endClientCache = new Map<string, CustomerRow | null>();
  const lookupEndClient = async (pattern: string): Promise<CustomerRow | null> => {
    if (endClientCache.has(pattern)) return endClientCache.get(pattern)!;
    const found = await deps.findEndClientByPattern(pattern);
    endClientCache.set(pattern, found);
    return found;
  };

  const rows: AuditRow[] = [];

  for (const property of properties) {
    const customer = fallbackById.get(property.customerId);
    if (!customer) continue;
    const matchedPattern = classifyFallback(customer.name);
    seenPropertyIds.add(property.id);
    const seed = seedByPropertyId.get(property.id) ?? null;
    const endClientPattern = seed?.endClientNamePattern ?? null;
    let endClientFound = false;
    if (endClientPattern !== null) {
      endClientFound = (await lookupEndClient(endClientPattern)) !== null;
    }

    let recommendation: string;
    if (seed === null) {
      recommendation =
        "ACTION — operator-created fallback attachment with no Task #328 seed. Manually re-attach this property to a real customer.";
    } else if (endClientPattern === null) {
      recommendation =
        "OK — operator-managed seed; fallback attachment is the intended state.";
    } else if (endClientFound) {
      recommendation =
        "ACTION — restart api-server: the seed will auto-repoint to the real end-client and delete the fallback.";
    } else {
      recommendation = `ACTION — import the master file so the '${endClientPattern}' end-client exists, then restart api-server to repoint.`;
    }

    rows.push({
      seed: seed?.seed ?? null,
      propertyId: property.id,
      propertyName: property.name,
      currentCustomerId: property.customerId,
      currentCustomerName: customer.name,
      matchedFallbackPattern: matchedPattern,
      endClientNamePattern: endClientPattern,
      endClientFound,
      recommendation,
    });
  }

  // 2) Healed seeds: for each seed-registry property NOT seen in the
  //    fallback sweep, emit an OK row so operators can confirm coverage.
  for (const entry of SEED_FALLBACKS) {
    if (seenPropertyIds.has(entry.propertyId)) continue;
    rows.push({
      seed: entry.seed,
      propertyId: entry.propertyId,
      propertyName: null,
      currentCustomerId: "(not attached to a fallback customer)",
      currentCustomerName: "(healed or not present)",
      matchedFallbackPattern: null,
      endClientNamePattern: entry.endClientNamePattern,
      endClientFound: false,
      recommendation:
        "OK — property is not attached to any fallback-like customer.",
    });
  }

  return rows;
}

export function formatAuditReport(rows: AuditRow[]): string {
  const lines: string[] = [];
  lines.push("Task #328 — fallback customer attachment audit");
  lines.push("=".repeat(60));
  lines.push("");
  if (rows.length === 0) {
    lines.push(
      "No properties attached to fallback-like customers, and no Task #328 seed properties found.",
    );
    return lines.join("\n");
  }
  for (const row of rows) {
    const tag = row.seed ?? "(non-seed)";
    lines.push(`[${tag}] property ${row.propertyId}`);
    lines.push(`  name             : ${row.propertyName ?? "(null)"}`);
    lines.push(
      `  current customer : ${row.currentCustomerName} (${row.currentCustomerId})`,
    );
    lines.push(
      `  fallback match   : ${row.matchedFallbackPattern ?? "(none)"}`,
    );
    lines.push(
      `  end-client       : ${row.endClientNamePattern ?? "(unknown — no master mapping)"}`,
    );
    lines.push(`  end-client found : ${row.endClientFound}`);
    lines.push(`  recommendation   : ${row.recommendation}`);
    lines.push("");
  }
  const actionable = rows.filter((r) => r.recommendation.startsWith("ACTION"));
  lines.push(
    `Summary: ${rows.length} rows reported, ${actionable.length} need action.`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error(
      "DATABASE_URL is not set — set it to the database you want to audit.",
    );
    process.exit(2);
  }
  const { db, customersTable, propertiesTable } = await import("@workspace/db");

  const rows = await auditFallbackAttachments({
    findFallbackCustomers: async (patterns) => {
      if (patterns.length === 0) return [];
      const conds = patterns.map((p) => like(customersTable.name, p));
      const result = await db
        .select({ id: customersTable.id, name: customersTable.name })
        .from(customersTable)
        .where(or(...conds)!);
      return result;
    },
    findPropertiesForCustomers: async (customerIds) => {
      if (customerIds.length === 0) return [];
      const result = await db
        .select({
          id: propertiesTable.id,
          customerId: propertiesTable.customerId,
          name: propertiesTable.name,
        })
        .from(propertiesTable)
        .where(inArray(propertiesTable.customerId, [...customerIds]));
      return result;
    },
    findEndClientByPattern: async (pattern) => {
      const result = await db
        .select({ id: customersTable.id, name: customersTable.name })
        .from(customersTable)
        .where(like(customersTable.name, pattern))
        .limit(1);
      return result[0] ?? null;
    },
  });

  console.log(formatAuditReport(rows));
  // Also expose a non-zero exit when actionable rows exist so this can
  // be wired into a manual pre-publish gate without parsing stdout.
  const actionable = rows.filter((r) => r.recommendation.startsWith("ACTION"));
  if (actionable.length > 0) process.exitCode = 3;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
