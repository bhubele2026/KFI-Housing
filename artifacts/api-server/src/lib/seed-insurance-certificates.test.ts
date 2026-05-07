import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  [k: string]: unknown;
}

const store = new Map<string, Row>();

type Predicate =
  | { kind: "eq"; col: string; value: unknown }
  | { kind: "and"; parts: Predicate[] };

function matches(row: Row, p: Predicate): boolean {
  if (p.kind === "eq") return row[p.col] === p.value;
  return p.parts.every((q) => matches(row, q));
}

const fakeTx = {
  select: (projection: Record<string, { __col: string }>) => ({
    from: (_t: unknown) => ({
      where: (pred: Predicate) => ({
        limit: async (_n: number) => {
          const matched = Array.from(store.values()).filter((r) =>
            matches(r, pred),
          );
          return matched.map((r) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(projection)) {
              out[k] = r[v.__col];
            }
            return out;
          });
        },
      }),
    }),
  }),
  insert: (_t: unknown) => ({
    values: (row: Row) => ({
      onConflictDoNothing: () => ({
        returning: async (_cols?: unknown) => {
          if (store.has(row.id)) return [];
          store.set(row.id, { ...row });
          return [{ id: row.id }];
        },
      }),
    }),
  }),
};

// We pass `fakeTx` to the production helper through `db.transaction(cb)` —
// the mocked `db` below routes the callback's `tx` arg to `fakeTx`. Because
// both `db.transaction` and `applyInsuranceCertificates` share the same
// source `Tx` type from `@workspace/db`, the boundary typechecks without
// any casts; the runtime fake just has to satisfy the methods the helper
// actually calls (`select…where…limit`, `insert…values…onConflictDoNothing…returning`).
const fakeDb = {
  transaction: <T,>(cb: (tx: typeof fakeTx) => Promise<T>): Promise<T> =>
    cb(fakeTx),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { __col: string }, value: unknown) => ({
    kind: "eq" as const,
    col: col.__col,
    value,
  }),
  and: (...parts: Predicate[]) => ({ kind: "and" as const, parts }),
}));

vi.mock("@workspace/db", () => ({
  db: fakeDb,
  insuranceCertificatesTable: {
    __table: "insurance_certificates",
    id: { __col: "id" },
    propertyId: { __col: "propertyId" },
    policyNumber: { __col: "policyNumber" },
  },
}));

const { db } = await import("@workspace/db");
const { applyInsuranceCertificates } = await import(
  "./seed-insurance-certificates"
);

const baseSpec = {
  id: "cert-1",
  propertyId: "prop-a",
  carrier: "Hartford",
  policyNumber: "PHU-001",
  insuredName: "KFI Staffing",
  coverageStart: "2026-01-01",
  coverageEnd: "2026-12-31",
  documentUrl: "ACORD_25.pdf",
  notes: "",
};

beforeEach(() => {
  store.clear();
});

describe("applyInsuranceCertificates", () => {
  it("inserts a fresh cert and returns 1", async () => {
    const inserted = await db.transaction((tx) =>
      applyInsuranceCertificates(tx, [baseSpec]),
    );
    expect(inserted).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get("cert-1")?.["carrier"]).toBe("Hartford");
  });

  it("dedupes by (propertyId, policyNumber) on a re-run", async () => {
    await db.transaction((tx) => applyInsuranceCertificates(tx, [baseSpec]));
    // Same property+policyNumber but a different id — should NOT insert.
    const inserted = await db.transaction((tx) =>
      applyInsuranceCertificates(tx, [
        { ...baseSpec, id: "cert-1-renamed" },
      ]),
    );
    expect(inserted).toBe(0);
    expect(store.size).toBe(1);
    expect(store.has("cert-1-renamed")).toBe(false);
  });

  it("treats the same policy number on a different property as a new cert", async () => {
    await db.transaction((tx) => applyInsuranceCertificates(tx, [baseSpec]));
    const inserted = await db.transaction((tx) =>
      applyInsuranceCertificates(tx, [
        { ...baseSpec, id: "cert-2", propertyId: "prop-b" },
      ]),
    );
    expect(inserted).toBe(1);
    expect(store.size).toBe(2);
  });

  it("falls back to id-based idempotency when policyNumber is empty", async () => {
    const empty = { ...baseSpec, policyNumber: "" };
    const first = await db.transaction((tx) =>
      applyInsuranceCertificates(tx, [empty]),
    );
    const second = await db.transaction((tx) =>
      applyInsuranceCertificates(tx, [empty]),
    );
    expect(first).toBe(1);
    expect(second).toBe(0); // onConflictDoNothing on the same id
    expect(store.size).toBe(1);
  });

  it("returns 0 for an empty spec list", async () => {
    const inserted = await db.transaction((tx) =>
      applyInsuranceCertificates(tx, []),
    );
    expect(inserted).toBe(0);
    expect(store.size).toBe(0);
  });
});
