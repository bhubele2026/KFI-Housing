/**
 * One-off importer for the 20 current customers (Task #559).
 *
 * Seeds the Customers tab with our actual current customer roster by
 * POSTing one customer at a time to the existing `POST /api/customers`
 * endpoint. Idempotent: fetches the current list first and skips any
 * name that already exists (case-insensitive exact match), so it is
 * safe to re-run.
 *
 * Only the `name` is set — every other field (contactName, email,
 * phone, notes, state, noHousingReason, customShifts) is intentionally
 * left at the API's default empty value so operators can fill them in
 * later through the existing edit UI.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx scripts/import-current-customers.ts
 *
 * Env:
 *   API_BASE_URL   defaults to http://localhost:8080
 */

const CUSTOMER_NAMES: readonly string[] = [
  "Adient",
  "Alamco Wood Products Inc",
  "Amesbury Truth-Owatonna",
  "Bell Lumber and Pole, LLC",
  "Bell Timber, Inc.",
  "Burnett Dairy - Grantsburg",
  "Cardinal CG - Northfield",
  "Cardinal CG - Spring Green",
  "DeLallo Foods",
  "Greystone Manufacturing",
  "International Wire Group, Inc",
  "Landscape Structures",
  "Milwaukee Valve",
  "Penda Corp",
  "Schreiber Foods-Richland Center East",
  "Schreiber Foods-Richland Center West",
  "Schuette Metals",
  "Shuster's Building Components",
  "Trienda Holdings",
  "WB Manufacturing",
];

interface CustomerLite {
  id: string;
  name: string;
}

/**
 * Build a stable, human-readable id from the customer name. Re-running
 * the importer with the same name produces the same id, which keeps
 * the operation idempotent even if the GET /customers list pre-check
 * is bypassed for any reason. Format mirrors the existing
 * `cust-<slug>` ids used by the seed scripts (e.g. `cust-adient`).
 */
function customerIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `cust-${slug}`;
}

async function main(): Promise<void> {
  const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(
    /\/+$/,
    "",
  );

  const listRes = await fetch(`${baseUrl}/api/customers`);
  if (!listRes.ok) {
    throw new Error(
      `GET /api/customers failed: ${listRes.status} ${listRes.statusText}`,
    );
  }
  const existing = (await listRes.json()) as CustomerLite[];
  const existingNames = new Set(
    existing.map((c) => c.name.trim().toLowerCase()),
  );

  let inserted = 0;
  let skipped = 0;
  for (const name of CUSTOMER_NAMES) {
    if (existingNames.has(name.trim().toLowerCase())) {
      console.log(`skip  (already exists): ${name}`);
      skipped += 1;
      continue;
    }
    const res = await fetch(`${baseUrl}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: customerIdFor(name),
        name,
        contactName: "",
        email: "",
        phone: "",
        notes: "",
        state: "",
        noHousingReason: null,
        customShifts: [],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `POST /api/customers failed for "${name}": ${res.status} ${res.statusText} — ${body}`,
      );
    }
    console.log(`added: ${name}`);
    inserted += 1;
  }

  console.log(
    `\nDone. inserted=${inserted}, skipped=${skipped}, total target=${CUSTOMER_NAMES.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
