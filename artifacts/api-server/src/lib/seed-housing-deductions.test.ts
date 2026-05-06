import { describe, expect, it, vi } from "vitest";
import {
  nameSimilarity,
  rankSuggestions,
  type SuggestionCandidate,
  type HousingDeductionRow,
} from "./seed-housing-deductions";

describe("nameSimilarity", () => {
  it("scores 1.0 for identical normalized names", () => {
    expect(nameSimilarity("Jane Smith", "JANE SMITH")).toBe(1);
  });

  it("ignores middle initials when token-matching (typo case from task)", () => {
    // "JANE A SMITH" vs "Jane Smith" — the single-letter "a" is a
    // middle initial and should not penalize the match.
    expect(nameSimilarity("JANE A SMITH", "Jane Smith")).toBe(1);
  });

  it("tolerates one-character typos via Levenshtein", () => {
    // 1 edit out of 11 chars ≈ 0.91
    expect(nameSimilarity("jonathan smith", "johnathan smith")).toBeGreaterThan(
      0.9,
    );
  });

  it("returns 0 for empty input", () => {
    expect(nameSimilarity("", "Jane Smith")).toBe(0);
  });

  it("scores low for unrelated names", () => {
    expect(nameSimilarity("Jane Smith", "Bob Jones")).toBeLessThan(0.4);
  });
});

const propertyNames = new Map<string, string>([
  ["prop-1", "Maple Court"],
  ["prop-2", "Oak Ridge"],
]);

const candidates: SuggestionCandidate[] = [
  { id: "occ-1", name: "Jane Smith", company: "Adient", propertyId: "prop-1" },
  { id: "occ-2", name: "Janet Smyth", company: "Adient", propertyId: "prop-2" },
  // Different employer — must be filtered out even with a perfect name match.
  { id: "occ-3", name: "Jane Smith", company: "Penda Corp", propertyId: "prop-1" },
  // Below the threshold even within the right employer.
  { id: "occ-4", name: "Bob Jones", company: "Adient", propertyId: "prop-1" },
  // Unassigned occupant — should still surface, with propertyName=null.
  { id: "occ-5", name: "Jayne Smith", company: "Adient", propertyId: null },
];

describe("rankSuggestions", () => {
  it("returns same-employer candidates ranked by descending similarity", () => {
    const result = rankSuggestions("JANE A SMITH", "Adient", candidates, propertyNames);
    const ids = result.map((s) => s.occupantId);
    // occ-3 (different company) and occ-4 (low score) excluded.
    expect(ids).not.toContain("occ-3");
    expect(ids).not.toContain("occ-4");
    expect(ids[0]).toBe("occ-1"); // exact-tokens beats fuzzier candidates
    expect(result[0]!.propertyName).toBe("Maple Court");
    expect(result.length).toBeLessThanOrEqual(3);
    // Sorted descending.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });

  it("matches employer case-insensitively and trims whitespace", () => {
    const result = rankSuggestions("JANE A SMITH", "  adient  ", candidates, propertyNames);
    expect(result.length).toBeGreaterThan(0);
  });

  it("reports propertyName as null for an unassigned candidate", () => {
    const result = rankSuggestions("Jayne Smith", "Adient", candidates, propertyNames);
    const occ5 = result.find((s) => s.occupantId === "occ-5");
    expect(occ5).toBeDefined();
    expect(occ5!.propertyName).toBeNull();
  });

  it("returns an empty array when nothing scores above the threshold", () => {
    const result = rankSuggestions("Zzzz Qqqq", "Adient", candidates, propertyNames);
    expect(result).toEqual([]);
  });

  it("caps suggestions to the configured limit", () => {
    const many: SuggestionCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      id: `occ-${i}`,
      name: `Jane Smith ${i}`,
      company: "Adient",
      propertyId: null,
    }));
    const result = rankSuggestions("Jane Smith", "Adient", many, new Map(), { limit: 3 });
    expect(result.length).toBe(3);
  });

  it("flags same-employer results with crossEmployer = false and includes company", () => {
    const result = rankSuggestions("JANE A SMITH", "Adient", candidates, propertyNames);
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(s.crossEmployer).toBe(false);
      expect(s.company).toBe("Adient");
    }
  });

  it("cross-employer mode only returns candidates from a different employer, all flagged", () => {
    const result = rankSuggestions(
      "JANE A SMITH",
      "Adient",
      candidates,
      propertyNames,
      { employerMode: "cross" },
    );
    // occ-3 ("Jane Smith" @ Penda Corp) should be the top hit; the
    // Adient candidates must be excluded entirely.
    const ids = result.map((s) => s.occupantId);
    expect(ids).toContain("occ-3");
    expect(ids).not.toContain("occ-1");
    expect(ids).not.toContain("occ-2");
    expect(ids).not.toContain("occ-5");
    for (const s of result) {
      expect(s.crossEmployer).toBe(true);
      expect(s.company.toLowerCase()).not.toBe("adient");
    }
  });
});

describe("seedHousingDeductions cross-employer fallback", () => {
  // Black-box behavior: when same-employer suggestions are empty the
  // seeder must still return cross-employer hits flagged accordingly.
  // Exercised at the rankSuggestions level — the seeder's only logic
  // here is "if same-employer is empty, run cross-employer". We assert
  // both branches return their expected shapes for the same input.
  it("returns same-employer hits when available, none flagged crossEmployer", () => {
    const same = rankSuggestions("JANE A SMITH", "Adient", candidates, propertyNames);
    expect(same.length).toBeGreaterThan(0);
    expect(same.every((s) => !s.crossEmployer)).toBe(true);
  });

  it("falls back to cross-employer hits when same-employer is empty", () => {
    // No Penda Corp candidate exists in the fixture aside from occ-3,
    // and "Jane Smith" matches it across employers.
    const onlyPendaSearchSpace: SuggestionCandidate[] = [
      { id: "occ-3", name: "Jane Smith", company: "Penda Corp", propertyId: "prop-1" },
    ];
    const same = rankSuggestions(
      "JANE SMITH",
      "Adient",
      onlyPendaSearchSpace,
      propertyNames,
    );
    expect(same).toEqual([]);
    const cross = rankSuggestions(
      "JANE SMITH",
      "Adient",
      onlyPendaSearchSpace,
      propertyNames,
      { employerMode: "cross" },
    );
    expect(cross.length).toBe(1);
    expect(cross[0]!.crossEmployer).toBe(true);
    expect(cross[0]!.company).toBe("Penda Corp");
    expect(cross[0]!.propertyName).toBe("Maple Court");
  });
});

// ---------------------------------------------------------------------------
// chargeSource provenance tests (Task #304)
// ---------------------------------------------------------------------------
//
// These tests exercise seedHousingDeductions itself with a mocked DB so we
// can assert the row-level writes (chargeSource = "payroll" + customer +
// personId stamps). The helpers above are pure and don't need the mock.

interface OccupantRow {
  id: string;
  name: string;
  employeeId: string;
  company: string;
  status: string;
  chargePerBed: number;
  billingFrequency: string;
  chargeSource: string;
  chargeSourceCustomer: string;
  chargeSourcePersonId: string;
}

// vi.mock factories are hoisted above top-level `const`s, so the shared
// state and the fake DB itself must live in a `vi.hoisted` block to be
// available when the factory runs.
const { occupants, fakeDb } = vi.hoisted(() => {
  type Row = {
    id: string;
    name: string;
    employeeId: string;
    company: string;
    status: string;
    chargePerBed: number;
    billingFrequency: string;
    chargeSource: string;
    chargeSourceCustomer: string;
    chargeSourcePersonId: string;
  };
  type Pred = { kind: "eq"; col: string; value: unknown };
  const occupants = new Map<string, Row>();
  const tableNameOf = (t: unknown) => (t as { __table: string }).__table;
  const rowField = (r: Record<string, unknown>, col: string) => r[col];
  const matches = (r: Row, p: Pred) =>
    rowField(r as unknown as Record<string, unknown>, p.col) === p.value;
  const tableRows = (table: unknown): Record<string, unknown>[] => {
    const t = tableNameOf(table);
    if (t === "occupants") {
      return Array.from(occupants.values()) as unknown as Record<string, unknown>[];
    }
    if (t === "properties") {
      return [];
    }
    throw new Error(`Unknown table ${t}`);
  };
  const fakeDb = {
    select: (projection: Record<string, { __col: string }>) => ({
      from: (table: unknown) =>
        tableRows(table).map((r) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(projection)) {
            out[k] = rowField(r, v.__col);
          }
          return out;
        }),
    }),
    update: (table: unknown) => ({
      set: (vals: Partial<Row>) => ({
        where: (pred: Pred) => {
          if (tableNameOf(table) !== "occupants") {
            throw new Error("update on unknown table");
          }
          for (const r of Array.from(occupants.values())) {
            if (matches(r, pred)) {
              occupants.set(r.id, { ...r, ...vals });
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { occupants, fakeDb };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  occupantsTable: {
    __table: "occupants",
    id: { __col: "id" },
    name: { __col: "name" },
    employeeId: { __col: "employeeId" },
    company: { __col: "company" },
    propertyId: { __col: "propertyId" },
    chargePerBed: { __col: "chargePerBed" },
    billingFrequency: { __col: "billingFrequency" },
    chargeSource: { __col: "chargeSource" },
    chargeSourceCustomer: { __col: "chargeSourceCustomer" },
    chargeSourcePersonId: { __col: "chargeSourcePersonId" },
  },
  propertiesTable: {
    __table: "properties",
    id: { __col: "id" },
    name: { __col: "name" },
  },
}));

const { seedHousingDeductions } = await import("./seed-housing-deductions");

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function occ(partial: Partial<OccupantRow> & { id: string }): OccupantRow {
  return {
    name: "",
    employeeId: "",
    company: "",
    status: "Active",
    chargePerBed: 0,
    billingFrequency: "Monthly",
    chargeSource: "",
    chargeSourceCustomer: "",
    chargeSourcePersonId: "",
    ...partial,
  };
}

function seed(rows: OccupantRow[]): void {
  occupants.clear();
  for (const r of rows) occupants.set(r.id, r);
}

const sampleRows: HousingDeductionRow[] = [
  { customer: "Adient", name: "MARISA L LOERA", personId: "2005126", weekly: 175 },
];

describe("seedHousingDeductions — chargeSource provenance (Task #304)", () => {
  it("stamps chargeSource + customer + personId on a freshly-matched occupant", async () => {
    seed([occ({ id: "o1", name: "MARISA L LOERA", employeeId: "2005126" })]);
    const result = await seedHousingDeductions({
      logger: silentLogger,
      rows: sampleRows,
    });
    expect(result.updated).toBe(1);
    expect(occupants.get("o1")).toMatchObject({
      chargePerBed: 175,
      billingFrequency: "Weekly",
      chargeSource: "payroll",
      chargeSourceCustomer: "Adient",
      chargeSourcePersonId: "2005126",
    });
  });

  it("treats a charge-correct row whose source stamps are missing as needing an update (so the badge appears on the next run)", async () => {
    seed([
      occ({
        id: "o1",
        name: "MARISA L LOERA",
        employeeId: "2005126",
        chargePerBed: 175,
        billingFrequency: "Weekly",
        // No chargeSource yet — pre-Task-#304 data.
      }),
    ]);
    const result = await seedHousingDeductions({
      logger: silentLogger,
      rows: sampleRows,
    });
    expect(result.updated).toBe(1);
    expect(result.alreadyCorrect).toBe(0);
    expect(occupants.get("o1")?.chargeSource).toBe("payroll");
  });

  it("is idempotent on a re-run — already-stamped rows count as alreadyCorrect with no writes", async () => {
    seed([
      occ({
        id: "o1",
        name: "MARISA L LOERA",
        employeeId: "2005126",
        chargePerBed: 175,
        billingFrequency: "Weekly",
        chargeSource: "payroll",
        chargeSourceCustomer: "Adient",
        chargeSourcePersonId: "2005126",
      }),
    ]);
    const result = await seedHousingDeductions({
      logger: silentLogger,
      rows: sampleRows,
    });
    expect(result.alreadyCorrect).toBe(1);
    expect(result.updated).toBe(0);
  });
});
