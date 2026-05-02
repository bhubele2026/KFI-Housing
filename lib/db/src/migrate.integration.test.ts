import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("./client", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("./schema");

  const client = new PGlite();
  const db = drizzle(client, { schema });

  return {
    db,
    pool: {
      end: async () => {
        await client.close();
      },
    },
  };
});

import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import { db, pool } from "./client";
import { pushSchemaIfNeeded } from "./migrate";
import * as schema from "./schema";

interface SchemaTableInfo {
  name: string;
  columns: string[];
}

const EXPECTED_TABLES: SchemaTableInfo[] = Object.values(schema)
  .filter((value) => isTable(value))
  .map((value) => {
    const table = value as Parameters<typeof getTableName>[0];
    return {
      name: getTableName(table),
      columns: Object.values(getTableColumns(table))
        .map((column) => (column as { name: string }).name)
        .sort(),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

afterAll(async () => {
  await pool.end();
});

describe("pushSchemaIfNeeded against a real Postgres (PGlite)", () => {
  it("cleanly pushes the current schema from an empty database", async () => {
    expect(EXPECTED_TABLES.length).toBeGreaterThan(0);

    const log = vi.fn();
    const result = await pushSchemaIfNeeded({ log });

    expect(result.applied).toBe(true);
    expect(result.statements.length).toBeGreaterThan(0);
    expect(result.hasDataLoss).toBe(false);

    const tableRows = await db.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const actualTables = (
      tableRows as unknown as { rows: Array<{ table_name: string }> }
    ).rows.map((row) => row.table_name);

    for (const expected of EXPECTED_TABLES) {
      expect(actualTables).toContain(expected.name);
    }
  }, 60_000);

  it("creates every column declared in the schema with the expected name", async () => {
    const columnRows = await db.execute(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const rows = (
      columnRows as unknown as {
        rows: Array<{ table_name: string; column_name: string }>;
      }
    ).rows;

    const actualColumnsByTable = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = actualColumnsByTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      actualColumnsByTable.set(row.table_name, set);
    }

    for (const expected of EXPECTED_TABLES) {
      const actualColumns = actualColumnsByTable.get(expected.name);
      expect(actualColumns, `missing table "${expected.name}"`).toBeDefined();
      for (const columnName of expected.columns) {
        expect(
          actualColumns!.has(columnName),
          `expected column "${expected.name}"."${columnName}" to exist after push`,
        ).toBe(true);
      }
    }
  }, 60_000);

  it("creates a primary key constraint for every table that declares one", async () => {
    const pkRows = await db.execute(
      `SELECT tc.table_name
       FROM information_schema.table_constraints tc
       WHERE tc.table_schema = 'public'
         AND tc.constraint_type = 'PRIMARY KEY'`,
    );
    const tablesWithPk = new Set(
      (pkRows as unknown as { rows: Array<{ table_name: string }> }).rows.map(
        (row) => row.table_name,
      ),
    );

    const expectedTablesWithPk = Object.values(schema)
      .filter((value) => isTable(value))
      .map((value) => value as Parameters<typeof getTableName>[0])
      .filter((table) =>
        Object.values(getTableColumns(table)).some(
          (column) => (column as { primary?: boolean }).primary === true,
        ),
      )
      .map((table) => getTableName(table));

    expect(expectedTablesWithPk.length).toBeGreaterThan(0);
    for (const tableName of expectedTablesWithPk) {
      expect(
        tablesWithPk.has(tableName),
        `expected primary key constraint on "${tableName}"`,
      ).toBe(true);
    }
  }, 60_000);
});
