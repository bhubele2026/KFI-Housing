// Task #564 one-off importer.
//
// Reads the operator-supplied "Customer_Address" XLSX dump and inserts
// one row in the `customers` table per spreadsheet row. Each payload
// is run through the project's `normalizeCustomerRow` boundary helper
// before insert so the same coercions any API write would get apply
// here too. The user confirmed the source file has no duplicates, so
// no dedup / upsert logic is performed: every row that has a name is
// inserted, every row missing a name is collected and reported.
//
// Usage:
//   pnpm --filter @workspace/scripts exec tsx \
//     ./src/import-customers-from-xlsx.ts \
//     attached_assets/Customer_Address_1778605488038.xlsx

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db, customersTable, type InsertCustomerRow } from "@workspace/db";

// Local copy of the relevant slice of `normalizeCustomerRow` from
// `artifacts/api-server/src/lib/db-row-normalizers.ts`. We can't import
// it across packages from a script (the api-server package isn't a
// dependency of @workspace/scripts), and this is a one-off script — so
// the boundary helper is duplicated in-line. The original normalizer
// only coerces `noHousingReason` and `customShifts`; neither is set by
// this importer, so the function is effectively a pass-through for the
// fields we send. It is wired in anyway so a future spreadsheet that
// adds either column would still flow through the same coercions a
// regular API write performs.
const CUSTOMER_NO_HOUSING_REASONS = new Set<string>([
  "provided_by_client",
  "kfis_property",
  "all_associates_local",
]);
function normalizeCustomerRow<T extends Partial<InsertCustomerRow>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  if ("noHousingReason" in row) {
    const v = row.noHousingReason;
    out.noHousingReason =
      typeof v === "string" && CUSTOMER_NO_HOUSING_REASONS.has(v.trim())
        ? v.trim()
        : null;
  }
  if ("customShifts" in row) {
    const v = row.customShifts;
    if (!Array.isArray(v)) {
      out.customShifts = [];
    } else {
      const seen = new Set<string>();
      const arr: string[] = [];
      for (const x of v) {
        if (typeof x !== "string") continue;
        const t = x.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        arr.push(t);
      }
      out.customShifts = arr;
    }
  }
  return out as T;
}

// Map full US state names (as written in the spreadsheet) to the
// 2-letter USPS code the customers schema stores. An empty / unknown
// state is stored as the empty string the schema defaults to so the
// row still imports cleanly.
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function toStateCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  return STATE_NAME_TO_CODE[trimmed.toLowerCase()] ?? "";
}

interface RawRow {
  Name?: string;
  State?: string;
  Phone?: string;
  Address?: string;
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      "Usage: tsx src/import-customers-from-xlsx.ts <path-to-xlsx>",
    );
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  const buf = readFileSync(abs);

  const XLSX = (await import("xlsx")) as typeof import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });

  const inserts: InsertCustomerRow[] = [];
  const skipped: { rowIndex: number; reason: string }[] = [];

  rows.forEach((r, i) => {
    const sourceRow = i + 2; // header is row 1
    const name = String(r.Name ?? "").trim();
    if (!name) {
      skipped.push({ rowIndex: sourceRow, reason: "missing required field: Name" });
      return;
    }
    const phone = String(r.Phone ?? "").trim();
    const stateCode = toStateCode(r.State);
    const addr = String(r.Address ?? "").trim();
    const noteParts: string[] = [];
    if (addr) noteParts.push(`Address: ${addr}`);
    noteParts.push(`Imported from Customer_Address spreadsheet row ${sourceRow}.`);
    const payload: InsertCustomerRow = {
      id: randomUUID(),
      name,
      contactName: "",
      email: "",
      phone,
      notes: noteParts.join("\n"),
      state: stateCode,
    };
    inserts.push(normalizeCustomerRow(payload));
  });

  let inserted = 0;
  if (inserts.length > 0) {
    const written = await db
      .insert(customersTable)
      .values(inserts)
      .returning({ id: customersTable.id });
    inserted = written.length;
  }

  console.log(`Inserted ${inserted} customer(s).`);
  if (skipped.length === 0) {
    console.log("No rows skipped.");
  } else {
    console.log(`Skipped ${skipped.length} row(s):`);
    for (const s of skipped) {
      console.log(`  row ${s.rowIndex}: ${s.reason}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
