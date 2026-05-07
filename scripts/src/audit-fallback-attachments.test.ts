import { describe, it, expect } from "vitest";
import {
  auditFallbackAttachments,
  formatAuditReport,
  SEED_FALLBACKS,
  FALLBACK_NAME_PATTERNS,
  type AuditDeps,
} from "./audit-fallback-attachments";

interface Customer {
  id: string;
  name: string;
}
interface Property {
  id: string;
  customerId: string;
  name: string | null;
}

function likeMatch(name: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .split("%")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
    "i",
  );
  return re.test(name);
}

function makeDeps(customers: Customer[], properties: Property[]): AuditDeps {
  return {
    findFallbackCustomers: async (patterns) =>
      customers.filter((c) => patterns.some((p) => likeMatch(c.name, p))),
    findPropertiesForCustomers: async (ids) =>
      properties.filter((p) => ids.includes(p.customerId)),
    findEndClientByPattern: async (pattern) =>
      customers.find((c) => likeMatch(c.name, pattern)) ?? null,
  };
}

describe("auditFallbackAttachments", () => {
  it("flags a seed-registered property still on KFI fallback when the end-client doesn't exist yet", async () => {
    const rows = await auditFallbackAttachments(
      makeDeps(
        [{ id: "cust-kfi-baraboo", name: "KFI Staffing – Baraboo, WI" }],
        [
          {
            id: "prop-patriot-baraboo-1850-pine",
            customerId: "cust-kfi-baraboo",
            name: "Patriot Baraboo",
          },
        ],
      ),
    );
    const row = rows.find((r) => r.propertyId === "prop-patriot-baraboo-1850-pine")!;
    expect(row.seed).toBe("patriot-baraboo");
    expect(row.matchedFallbackPattern).toBe("KFI Staffing%");
    expect(row.endClientFound).toBe(false);
    expect(row.recommendation).toMatch(/ACTION.*import the master file/);
  });

  it("flags a seed property still on KFI fallback when end-client exists (auto-repoint pending restart)", async () => {
    const rows = await auditFallbackAttachments(
      makeDeps(
        [
          { id: "cust-kfi-wausau", name: "KFI Staffing – Wausau, WI" },
          { id: "cust-schuette", name: "Schuette Metals - Rothschild, WI" },
        ],
        [
          {
            id: "prop-kolbe-wausau-s-8th-ave",
            customerId: "cust-kfi-wausau",
            name: "Kolbe Wausau",
          },
        ],
      ),
    );
    const row = rows.find((r) => r.propertyId === "prop-kolbe-wausau-s-8th-ave")!;
    expect(row.endClientFound).toBe(true);
    expect(row.recommendation).toMatch(/ACTION.*restart api-server/);
  });

  it("flags a non-seed (operator-created) property attached to a fallback-like customer", async () => {
    const rows = await auditFallbackAttachments(
      makeDeps(
        [{ id: "cust-unknown", name: "Unknown employer" }],
        [
          {
            id: "prop-operator-misc-1",
            customerId: "cust-unknown",
            name: "Operator-created property",
          },
        ],
      ),
    );
    const row = rows.find((r) => r.propertyId === "prop-operator-misc-1")!;
    expect(row.seed).toBeNull();
    expect(row.matchedFallbackPattern).toBe("Unknown%");
    expect(row.recommendation).toMatch(/ACTION.*operator-created/);
  });

  it("emits a healed-OK row for a seed property that is no longer attached to any fallback customer", async () => {
    const rows = await auditFallbackAttachments(
      makeDeps(
        [{ id: "cust-greystone", name: "Greystone Manufacturing - Bettendorf, IA" }],
        [
          {
            id: "prop-chateau-knoll-bettendorf",
            customerId: "cust-greystone",
            name: "Chateau Knoll",
          },
        ],
      ),
    );
    const row = rows.find((r) => r.propertyId === "prop-chateau-knoll-bettendorf")!;
    expect(row.matchedFallbackPattern).toBeNull();
    expect(row.recommendation).toMatch(/^OK/);
  });

  it("emits healed-OK rows for every seed when the database has no fallback customers at all", async () => {
    const rows = await auditFallbackAttachments(makeDeps([], []));
    expect(rows).toHaveLength(SEED_FALLBACKS.length);
    for (const r of rows) expect(r.recommendation).toMatch(/^OK/);
  });

  it("formats a multi-line report with a summary line", async () => {
    const rows = await auditFallbackAttachments(
      makeDeps(
        [
          { id: "cust-kfi-baraboo", name: "KFI Staffing – Baraboo, WI" },
          { id: "cust-tbd", name: "TBD - operator placeholder" },
        ],
        [
          {
            id: "prop-patriot-baraboo-1850-pine",
            customerId: "cust-kfi-baraboo",
            name: "Patriot",
          },
          {
            id: "prop-operator-1",
            customerId: "cust-tbd",
            name: "Operator",
          },
        ],
      ),
    );
    const report = formatAuditReport(rows);
    expect(report).toMatch(/Task #328/);
    expect(report).toMatch(/need action/);
  });

  it("FALLBACK_NAME_PATTERNS covers KFI, Unknown, TBD, Placeholder", () => {
    const cases = [
      "KFI Staffing – Wausau, WI",
      "Unknown employer",
      "TBD",
      "TBD - to be assigned",
      "Placeholder customer",
      "Some Real Co (placeholder)",
    ];
    for (const name of cases) {
      const matched = FALLBACK_NAME_PATTERNS.some((p) => {
        const re = new RegExp(
          "^" +
            p.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") +
            "$",
          "i",
        );
        return re.test(name);
      });
      expect(matched, `pattern set should match: ${name}`).toBe(true);
    }
    // And a real customer name should NOT match.
    const realName = "Greystone Manufacturing - Bettendorf, IA";
    const realMatched = FALLBACK_NAME_PATTERNS.some((p) => {
      const re = new RegExp(
        "^" +
          p.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") +
          "$",
        "i",
      );
      return re.test(realName);
    });
    expect(realMatched).toBe(false);
  });

  // Drift guard (Task #328): the audit script's hardcoded property /
  // customer IDs MUST match the canonical exported constants in each
  // seed module. If a seed renames an ID, this test fails loudly so the
  // audit script can't silently start skipping rows.
  it("uses canonical seed IDs (drift guard against artifacts/api-server/src/lib/seed-*.ts)", async () => {
    const seedConstants: Record<string, { propertyId: string; customerId: string }> = {
      "chateau-knoll": await loadIds("seed-chateau-knoll", "CHATEAU_KNOLL"),
      "patriot-baraboo": await loadIds("seed-patriot-baraboo", "PATRIOT_BARABOO"),
      "kolbe-wausau": await loadIds("seed-kolbe-wausau", "KOLBE_WAUSAU"),
      "greenock-manor": await loadIds("seed-greenock-manor", "GREENOCK_MANOR"),
      "hickory-haven": await loadIds("seed-hickory-haven", "HICKORY_HAVEN"),
      "park-place": await loadIds("seed-park-place", "PARK_PLACE"),
    };
    for (const entry of SEED_FALLBACKS) {
      const real = seedConstants[entry.seed];
      expect(real, `unknown seed in registry: ${entry.seed}`).toBeDefined();
      expect(entry.propertyId).toBe(real!.propertyId);
      expect(entry.fallbackCustomerId).toBe(real!.customerId);
    }
  });
});

async function loadIds(
  module: string,
  prefix: string,
): Promise<{ propertyId: string; customerId: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const seedPath = path.resolve(
    here,
    "..",
    "..",
    "artifacts",
    "api-server",
    "src",
    "lib",
    `${module}.ts`,
  );
  // Parse the constant out of the seed source rather than executing it
  // (the seed module imports @workspace/db which would pull in DB
  // drivers in a unit-test process).
  const src = await fs.readFile(seedPath, "utf8");
  const findId = (suffix: string): string => {
    const re = new RegExp(
      `export\\s+const\\s+${prefix}_${suffix}\\s*=\\s*"([^"]+)"`,
    );
    const m = src.match(re);
    if (!m) {
      throw new Error(`missing export const ${prefix}_${suffix} in ${module}`);
    }
    return m[1]!;
  };
  return {
    propertyId: findId("PROPERTY_ID"),
    customerId: findId("CUSTOMER_ID"),
  };
}
