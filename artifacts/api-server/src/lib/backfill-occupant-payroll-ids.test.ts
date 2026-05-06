import { describe, it, expect, vi } from "vitest";
import type { HousingDeductionRow } from "./seed-housing-deductions";

interface OccupantRow {
  id: string;
  name: string;
  employeeId: string;
  company: string;
  status: string;
}

const occupants = new Map<string, OccupantRow>();

type Predicate = { kind: "eq"; col: string; value: unknown };

function tableNameOf(t: unknown): string {
  return (t as { __table: string }).__table;
}

function rowField(row: OccupantRow, col: string): unknown {
  return (row as unknown as Record<string, unknown>)[col];
}

function matches(row: OccupantRow, p: Predicate): boolean {
  return rowField(row, p.col) === p.value;
}

function tableRows(table: unknown): OccupantRow[] {
  if (tableNameOf(table) !== "occupants") {
    throw new Error(`Unknown table ${tableNameOf(table)}`);
  }
  return Array.from(occupants.values());
}

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
    set: (vals: Partial<OccupantRow>) => ({
      where: (pred: Predicate) => {
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
    status: { __col: "status" },
  },
}));

const { backfillOccupantPayrollIds } = await import(
  "./backfill-occupant-payroll-ids"
);

const silentLogger = { info: vi.fn(), warn: vi.fn() };

function occ(partial: Partial<OccupantRow> & { id: string; name: string }): OccupantRow {
  return {
    employeeId: "",
    company: "",
    status: "Active",
    ...partial,
  };
}

function seed(rows: OccupantRow[]): void {
  occupants.clear();
  for (const r of rows) occupants.set(r.id, r);
}

const sampleRows: HousingDeductionRow[] = [
  { customer: "Adient", name: "MARISA L LOERA", personId: "2005126", weekly: 175 },
  { customer: "Penda Corp", name: "DULCE ASCENCIO", personId: "2001231", weekly: 175 },
];

describe("backfillOccupantPayrollIds", () => {
  it("fills both employeeId and company on a unique-name occupant", async () => {
    seed([
      occ({ id: "o1", name: "Marisa L Loera" }),
      occ({ id: "o2", name: "Dulce Ascencio" }),
    ]);
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: sampleRows,
    });
    expect(result.matchedOccupants).toBe(2);
    expect(result.matchedExact).toBe(2);
    expect(result.employeeIdFilled).toBe(2);
    expect(result.companyFilled).toBe(2);
    expect(result.alreadyComplete).toBe(0);
    expect(occupants.get("o1")).toMatchObject({
      employeeId: "2005126",
      company: "Adient",
    });
    expect(occupants.get("o2")).toMatchObject({
      employeeId: "2001231",
      company: "Penda Corp",
    });
  });

  it("only fills empty fields and counts the rest as already complete", async () => {
    seed([
      occ({ id: "o1", name: "MARISA L LOERA", employeeId: "EXISTING" }),
      occ({
        id: "o2",
        name: "DULCE ASCENCIO",
        employeeId: "2001231",
        company: "Penda Corp",
      }),
    ]);
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: sampleRows,
    });
    expect(result.matchedOccupants).toBe(2);
    expect(result.employeeIdFilled).toBe(0);
    expect(result.companyFilled).toBe(1);
    expect(result.alreadyComplete).toBe(1);
    expect(occupants.get("o1")).toMatchObject({
      employeeId: "EXISTING", // not overwritten
      company: "Adient",
    });
  });

  it("overwrites Shift:-prefixed company values with the real payroll company", async () => {
    seed([
      occ({
        id: "o1",
        name: "Marisa L Loera",
        employeeId: "2005126",
        company: "Shift: 7AM - 4PM | 1st shift",
      }),
    ]);
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: [sampleRows[0]!],
    });
    expect(result.companyFilled).toBe(1);
    expect(result.employeeIdFilled).toBe(0);
    expect(occupants.get("o1")!.company).toBe("Adient");
  });

  it("matches when the DB name has fewer significant tokens than payroll", async () => {
    // Real-world variants we hit in dev: payroll has full middle name(s),
    // DB has the shortened legal name.
    seed([
      occ({ id: "o1", name: "Wilber Barrientos" }),
      occ({ id: "o2", name: "Victor A. Valenzuela" }),
      occ({ id: "o3", name: "Alfonzo Deray Tucker" }),
    ]);
    const rows: HousingDeductionRow[] = [
      { customer: "International Wire Group, Inc", name: "WILBER R BARRIENTOS FLORES", personId: "2005056", weekly: 80 },
      { customer: "Greystone Manufacturing", name: "VICTOR ALFONSO VALENZUELA ESPINOZA", personId: "2005074", weekly: 126 },
      { customer: "Penda Corp", name: "ALFONZO D TUCKER", personId: "2004985", weekly: 175 },
    ];
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows,
    });
    expect(result.matchedOccupants).toBe(3);
    expect(result.matchedSubset).toBe(3);
    expect(occupants.get("o1")).toMatchObject({
      employeeId: "2005056",
      company: "International Wire Group, Inc",
    });
    expect(occupants.get("o2")!.employeeId).toBe("2005074");
    expect(occupants.get("o3")!.employeeId).toBe("2004985");
  });

  it("matches when the DB name has more significant tokens than payroll", async () => {
    // E.g. payroll "JOHN T CLARK" → DB "John Tyler Clark".
    seed([occ({ id: "o1", name: "John Tyler Clark" })]);
    const rows: HousingDeductionRow[] = [
      { customer: "Penda Corp", name: "JOHN T CLARK", personId: "2004954", weekly: 175 },
    ];
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows,
    });
    expect(result.matchedOccupants).toBe(1);
    expect(result.matchedSubset).toBe(1);
    expect(occupants.get("o1")!.employeeId).toBe("2004954");
  });

  it("ignores punctuation and the JR suffix when comparing names", async () => {
    seed([occ({ id: "o1", name: "Willie A. Medina Jr" })]);
    const rows: HousingDeductionRow[] = [
      { customer: "Burnett Dairy - Grantsburg", name: "WILLIE A MEDINA JR", personId: "2004792", weekly: 116 },
    ];
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows,
    });
    expect(result.matchedOccupants).toBe(1);
    expect(occupants.get("o1")!.employeeId).toBe("2004792");
  });

  it("excludes inactive occupants from the candidate pool", async () => {
    seed([
      occ({ id: "o1", name: "Marisa L Loera", status: "Inactive" }),
      occ({ id: "o2", name: "Marisa L Loera", status: "Active" }),
    ]);
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: [sampleRows[0]!],
    });
    expect(result.matchedOccupants).toBe(1);
    expect(occupants.get("o1")!.employeeId).toBe(""); // inactive untouched
    expect(occupants.get("o2")!.employeeId).toBe("2005126");
  });

  it("skips ambiguous matches instead of guessing", async () => {
    seed([
      occ({ id: "o1", name: "marisa l loera" }),
      occ({ id: "o2", name: "MARISA L LOERA" }),
    ]);
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: [sampleRows[0]!],
    });
    expect(result.matchedOccupants).toBe(0);
    expect(result.ambiguousNames).toHaveLength(1);
    expect(occupants.get("o1")!.employeeId).toBe("");
    expect(occupants.get("o2")!.employeeId).toBe("");
  });

  it("does not let one payroll row consume the same DB occupant twice across subset matches", async () => {
    // Two payroll rows that both subset-match a single DB occupant by
    // different paths could otherwise collide. The first wins; the
    // second falls through.
    seed([occ({ id: "o1", name: "Jordan Smith" })]);
    const rows: HousingDeductionRow[] = [
      { customer: "Trienda Holdings", name: "JORDAN T SMITH", personId: "2004574", weekly: 175 },
      { customer: "Trienda Holdings", name: "JORDAN SMITH SOMETHING", personId: "9999999", weekly: 100 },
    ];
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows,
    });
    expect(result.matchedOccupants).toBe(1);
    expect(occupants.get("o1")!.employeeId).toBe("2004574");
  });

  it("reports payroll rows with no matching occupant", async () => {
    seed([occ({ id: "o1", name: "SOMEONE ELSE ENTIRELY" })]);
    const result = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: sampleRows,
    });
    expect(result.matchedOccupants).toBe(0);
    expect(result.unmatchedRows).toHaveLength(2);
  });

  it("is idempotent on a second pass", async () => {
    seed([occ({ id: "o1", name: "Marisa L Loera" })]);
    await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: [sampleRows[0]!],
    });
    const second = await backfillOccupantPayrollIds({
      logger: silentLogger,
      rows: [sampleRows[0]!],
    });
    expect(second.employeeIdFilled).toBe(0);
    expect(second.companyFilled).toBe(0);
    expect(second.alreadyComplete).toBe(1);
    expect(occupants.get("o1")).toMatchObject({
      employeeId: "2005126",
      company: "Adient",
    });
  });
});
