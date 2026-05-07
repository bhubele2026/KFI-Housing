/**
 * One-off importer for the 20 current customers (Tasks #559 + #561).
 *
 * Pass 1 (Task #559): seeds the Customers tab with our actual current
 * customer roster by POSTing one customer at a time to the existing
 * `POST /api/customers` endpoint. Idempotent: fetches the current list
 * first and skips any name that already exists (case-insensitive
 * exact match), so it is safe to re-run. Only the `name` is set —
 * every other field (contactName, email, phone, notes, state,
 * noHousingReason, customShifts) is intentionally left at the API's
 * default empty value so operators can fill them in later through the
 * existing edit UI.
 *
 * Pass 2 (Task #561): links each freshly-imported customer to a real
 * property + active lease so the Customers tab no longer shows zeros
 * across the Properties / Occupancy / Revenue columns. For every
 * customer that does NOT already own (or share) a property — most of
 * the larger crews are already wired up by the named seed scripts
 * (Adient, Chateau Knoll → Greystone, Patriot Baraboo → Milwaukee
 * Valve, Kolbe Wausau → Schuette, Ridge Motor Inn → Penda + Trienda,
 * attached-leases → DeLallo) — we POST one placeholder property +
 * one active lease via the public API. Stable ids
 * (`prop-<slug>-primary` / `lease-<slug>-primary`) keep the second
 * pass idempotent across re-runs.
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

interface PropertyLite {
  id: string;
  customerId: string;
  sharedWithCustomerIds?: string[];
}

interface LeaseLite {
  id: string;
  propertyId: string;
  status: string;
  customerId?: string | null;
}

/**
 * Build a stable, human-readable id from the customer name. Re-running
 * the importer with the same name produces the same id, which keeps
 * the operation idempotent even if the GET /customers list pre-check
 * is bypassed for any reason. Format mirrors the existing
 * `cust-<slug>` ids used by the seed scripts (e.g. `cust-adient`).
 */
function slugFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function customerIdFor(name: string): string {
  return `cust-${slugFor(name)}`;
}

function placeholderPropertyIdFor(name: string): string {
  return `prop-${slugFor(name)}-primary`;
}

function placeholderLeaseIdFor(name: string): string {
  return `lease-${slugFor(name)}-primary`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromIso(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

async function ensureCustomers(
  baseUrl: string,
): Promise<{ inserted: number; skipped: number }> {
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
      console.log(`customer skip  (already exists): ${name}`);
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
    console.log(`customer added: ${name}`);
    inserted += 1;
  }
  return { inserted, skipped };
}

/**
 * Pass 2: ensure every customer in `CUSTOMER_NAMES` is linked to at
 * least one property AND has at least one active lease against one of
 * those properties so the Customers tab rolls up non-zero Properties /
 * Occupancy / Revenue.
 *
 * Customers that already own (or share) any property — typically wired
 * up by the dedicated seed scripts (Adient, Chateau Knoll, Patriot
 * Baraboo, Kolbe Wausau, Ridge Motor Inn, attached-leases) — reuse
 * those properties; the active-lease check then runs against them too,
 * so we never duplicate a lease that's already on file.
 *
 * For customers with no property linkage we provision one placeholder
 * property at a stable id (`prop-<slug>-primary`); for any customer
 * still missing an active lease across its linked properties we
 * provision one placeholder lease at a stable id
 * (`lease-<slug>-primary`) against the first linked property
 * (sorted by id, so re-runs target the same property deterministically).
 *
 * The two checks are independent — a partial-failure rerun (property
 * inserted, lease POST 500'd) repairs the missing lease instead of
 * skipping the customer because the property already exists. A
 * per-customer try/catch keeps one bad customer from aborting the
 * whole pass; the failure is logged and counted, and the script exits
 * non-zero at the end so CI / operators notice.
 */
async function linkPropertiesAndLeases(
  baseUrl: string,
): Promise<{
  propertiesInserted: number;
  leasesInserted: number;
  propertiesAlreadyLinked: number;
  leasesAlreadyActive: number;
  failed: number;
}> {
  const [customersRes, propertiesRes, leasesRes] = await Promise.all([
    fetch(`${baseUrl}/api/customers`),
    fetch(`${baseUrl}/api/properties`),
    fetch(`${baseUrl}/api/leases`),
  ]);
  if (!customersRes.ok) {
    throw new Error(
      `GET /api/customers failed: ${customersRes.status} ${customersRes.statusText}`,
    );
  }
  if (!propertiesRes.ok) {
    throw new Error(
      `GET /api/properties failed: ${propertiesRes.status} ${propertiesRes.statusText}`,
    );
  }
  if (!leasesRes.ok) {
    throw new Error(
      `GET /api/leases failed: ${leasesRes.status} ${leasesRes.statusText}`,
    );
  }
  const customers = (await customersRes.json()) as CustomerLite[];
  const properties = (await propertiesRes.json()) as PropertyLite[];
  const leases = (await leasesRes.json()) as LeaseLite[];

  const customerByLowercaseName = new Map<string, CustomerLite>();
  for (const c of customers) {
    customerByLowercaseName.set(c.name.trim().toLowerCase(), c);
  }

  // For each customer id → the property ids that mention it (primary
  // tenant or shared). Used to decide whether to provision a property
  // and which property the lease should attach to.
  const propertyIdsByCustomerId = new Map<string, Set<string>>();
  for (const p of properties) {
    const ids = [p.customerId, ...(p.sharedWithCustomerIds ?? [])].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    for (const id of ids) {
      let bucket = propertyIdsByCustomerId.get(id);
      if (!bucket) {
        bucket = new Set();
        propertyIdsByCustomerId.set(id, bucket);
      }
      bucket.add(p.id);
    }
  }

  // For each property id → its property row. Lets us know the
  // property's primary `customerId` when validating an existing
  // active lease's tenant override.
  const propertyById = new Map<string, PropertyLite>();
  for (const p of properties) propertyById.set(p.id, p);

  /** Resolve the customer responsible for a lease — the per-lease
   * `customerId` override when set, otherwise the parent property's
   * `customerId`. Mirrors `getCustomerResponsibleLeases` semantics. */
  function leaseCustomerId(lease: LeaseLite): string | null {
    if (lease.customerId && lease.customerId.length > 0) {
      return lease.customerId;
    }
    const prop = propertyById.get(lease.propertyId);
    return prop?.customerId ?? null;
  }

  // For each customer id → the set of property ids on which it has
  // at least one Active lease. Drives the lease-provisioning check.
  const activeLeasePropertyIdsByCustomerId = new Map<string, Set<string>>();
  for (const lease of leases) {
    if (lease.status !== "Active") continue;
    const ownerId = leaseCustomerId(lease);
    if (!ownerId) continue;
    let bucket = activeLeasePropertyIdsByCustomerId.get(ownerId);
    if (!bucket) {
      bucket = new Set();
      activeLeasePropertyIdsByCustomerId.set(ownerId, bucket);
    }
    bucket.add(lease.propertyId);
  }

  let propertiesInserted = 0;
  let leasesInserted = 0;
  let propertiesAlreadyLinked = 0;
  let leasesAlreadyActive = 0;
  let failed = 0;

  const start = todayIso();
  const end = oneYearFromIso(start);

  for (const name of CUSTOMER_NAMES) {
    try {
      const customer = customerByLowercaseName.get(name.trim().toLowerCase());
      if (!customer) {
        // Should never happen — pass 1 guarantees the customer exists.
        console.warn(`link skip (customer missing): ${name}`);
        failed += 1;
        continue;
      }

      // --- 1. Ensure at least one property links to this customer. ---
      let linkedPropertyIds = Array.from(
        propertyIdsByCustomerId.get(customer.id) ?? new Set<string>(),
      );
      if (linkedPropertyIds.length === 0) {
        const propertyId = placeholderPropertyIdFor(name);
        const propRes = await fetch(`${baseUrl}/api/properties`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: propertyId,
            customerId: customer.id,
            name: `${name} — Crew Housing`,
            address: "",
            city: "",
            state: "",
            zip: "",
            totalBeds: 4,
            monthlyRent: 2000,
            chargePerBed: 500,
            status: "Active",
            landlordName: "",
            landlordEmail: "",
            landlordPhone: "",
            paymentMethod: "ACH",
            paymentRecipient: "",
            paymentDueDay: 1,
            paymentNotes: "",
            bankName: "",
            bankRouting: "",
            bankAccount: "",
            portalUrl: "",
            notes:
              "Placeholder property created by import-current-customers (Task #561) " +
              "to link this customer to housing. Replace with real address, bed " +
              "count, and rent once the property of record is identified.",
            furnishings: [],
          }),
        });
        if (!propRes.ok) {
          const body = await propRes.text();
          throw new Error(
            `POST /api/properties failed: ${propRes.status} ${propRes.statusText} — ${body}`,
          );
        }
        propertiesInserted += 1;
        linkedPropertyIds = [propertyId];
        propertyById.set(propertyId, {
          id: propertyId,
          customerId: customer.id,
          sharedWithCustomerIds: [],
        });
        console.log(`property added: ${name} → ${propertyId}`);
      } else {
        propertiesAlreadyLinked += 1;
      }

      // --- 2. Independently ensure at least one Active lease. ---
      const activePropertyIds =
        activeLeasePropertyIdsByCustomerId.get(customer.id) ?? new Set<string>();
      const hasActiveLease = linkedPropertyIds.some((pid) =>
        activePropertyIds.has(pid),
      );
      if (hasActiveLease) {
        leasesAlreadyActive += 1;
        continue;
      }

      // Attach the placeholder lease to a deterministic property
      // (lowest id; falls back to the just-created placeholder when
      // it's the only one). The per-lease `customerId` override is
      // set explicitly so shared properties (e.g. Ridge Motor Inn)
      // route the new lease to *this* customer specifically.
      const targetPropertyId = [...linkedPropertyIds].sort()[0]!;
      const leaseId = placeholderLeaseIdFor(name);
      const leaseRes = await fetch(`${baseUrl}/api/leases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: leaseId,
          propertyId: targetPropertyId,
          customerId: customer.id,
          startDate: start,
          endDate: end,
          monthlyRent: 2000,
          securityDeposit: 0,
          status: "Active",
          notes:
            "Placeholder active lease created by import-current-customers " +
            "(Task #561) so occupancy / revenue roll-ups populate. Replace " +
            "with the real term and rent once the lease of record is on file.",
        }),
      });
      if (!leaseRes.ok) {
        const body = await leaseRes.text();
        throw new Error(
          `POST /api/leases failed: ${leaseRes.status} ${leaseRes.statusText} — ${body}`,
        );
      }
      leasesInserted += 1;
      console.log(
        `lease added:    ${name} → ${leaseId} (on ${targetPropertyId})`,
      );
    } catch (err) {
      failed += 1;
      console.error(`link FAILED for "${name}":`, err);
    }
  }

  return {
    propertiesInserted,
    leasesInserted,
    propertiesAlreadyLinked,
    leasesAlreadyActive,
    failed,
  };
}

async function main(): Promise<void> {
  const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(
    /\/+$/,
    "",
  );

  const cust = await ensureCustomers(baseUrl);
  const link = await linkPropertiesAndLeases(baseUrl);

  console.log(
    `\nDone. customers inserted=${cust.inserted} skipped=${cust.skipped}; ` +
      `properties inserted=${link.propertiesInserted} ` +
      `(already linked=${link.propertiesAlreadyLinked}); ` +
      `leases inserted=${link.leasesInserted} ` +
      `(already active=${link.leasesAlreadyActive}); ` +
      `failed=${link.failed}; total target=${CUSTOMER_NAMES.length}`,
  );

  if (link.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
