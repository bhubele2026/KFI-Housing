import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end tests for the per-tab Building filters on the property
 * detail page (Task #590).
 *
 * The Leases and Units tabs render a "Building" picker on multi-building
 * properties (e.g. the Schuette duplex 1331/1341 S 8th Ave). Picking a
 * building should shrink the lease table and the units list to that
 * building only; switching back to "All buildings" should restore the
 * full lists.
 *
 * Data is injected via Playwright route interception so the test is
 * deterministic and doesn't depend on real database state.
 */

const CUSTOMER = {
  id: "c-pw-bldg",
  name: "Schuette Metals",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
  state: "",
};

const PROPERTY = {
  id: "prop-pw-bldg",
  customerId: CUSTOMER.id,
  name: "Schuette Duplex",
  address: "1331 S 8th Ave",
  city: "Wausau",
  state: "WI",
  zip: "54401",
  totalBeds: 4,
  monthlyRent: 4000,
  chargePerBed: 0,
  status: "Active" as const,
  landlordName: "",
  landlordEmail: "",
  landlordPhone: "",
  paymentMethod: "" as const,
  paymentRecipient: "",
  paymentDueDay: 0,
  bankName: "",
  bankRouting: "",
  bankAccount: "",
  portalUrl: "",
  furnishings: [] as string[],
  sharedWithCustomerIds: [] as string[],
  lat: null,
  lng: null,
  coordsVerified: false,
  paymentNotes: "",
  notes: "",
};

const BUILDING_A = {
  id: "bldg-pw-a",
  propertyId: PROPERTY.id,
  name: "1331 S 8th Ave",
  address: "1331 S 8th Ave",
  city: "Wausau",
  state: "WI",
  zip: "54401",
  notes: "",
};

const BUILDING_B = {
  id: "bldg-pw-b",
  propertyId: PROPERTY.id,
  name: "1341 S 8th Ave",
  address: "1341 S 8th Ave",
  city: "Wausau",
  state: "WI",
  zip: "54401",
  notes: "",
};

const LEASE_DEFAULTS = {
  propertyId: PROPERTY.id,
  startDate: "2025-01-01",
  endDate: "2026-01-01",
  monthlyRent: 1000,
  securityDeposit: 0,
  status: "Active" as const,
  notes: "",
  needsReview: false,
  snoozedUntil: "",
};

const LEASE_A1 = { ...LEASE_DEFAULTS, id: "lease-pw-a1", buildingId: BUILDING_A.id, unit: "100" };
const LEASE_A2 = { ...LEASE_DEFAULTS, id: "lease-pw-a2", buildingId: BUILDING_A.id, unit: "200" };
const LEASE_B1 = { ...LEASE_DEFAULTS, id: "lease-pw-b1", buildingId: BUILDING_B.id, unit: "300" };
const LEASE_B2 = { ...LEASE_DEFAULTS, id: "lease-pw-b2", buildingId: BUILDING_B.id, unit: "400" };

const ALL_LEASES = [LEASE_A1, LEASE_A2, LEASE_B1, LEASE_B2];

async function fulfillJsonGet(route: Route, json: unknown) {
  if (route.request().method() !== "GET") {
    await route.continue();
    return;
  }
  await route.fulfill({ json });
}

async function setupRouteInterception(page: import("@playwright/test").Page) {
  await Promise.all([
    page.route("**/api/customers", (route) => fulfillJsonGet(route, [CUSTOMER])),
    page.route("**/api/properties", (route) => fulfillJsonGet(route, [PROPERTY])),
    page.route("**/api/buildings", (route) =>
      fulfillJsonGet(route, [BUILDING_A, BUILDING_B]),
    ),
    page.route("**/api/leases", (route) => fulfillJsonGet(route, ALL_LEASES)),
    page.route("**/api/rooms", (route) => fulfillJsonGet(route, [])),
    page.route("**/api/beds", (route) => fulfillJsonGet(route, [])),
    page.route("**/api/occupants", (route) => fulfillJsonGet(route, [])),
    page.route("**/api/utilities", (route) => fulfillJsonGet(route, [])),
    page.route("**/api/insurance-certificates", (route) =>
      fulfillJsonGet(route, []),
    ),
    page.route("**/api/room-night-logs", (route) => fulfillJsonGet(route, [])),
    page.route("**/api/payroll/unplaced", (route) =>
      fulfillJsonGet(route, { unmatched: [], lowConfidenceMatches: [] }),
    ),
  ]);
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pw-building-filters@test.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  // Belt-and-suspenders: wait for the dashboard's queries to settle.
  // Historically this was load-bearing — PropertyDetail had `useMemo`s
  // sitting BELOW its `isLoading` early return, so mounting mid-load
  // crashed with "Rendered more hooks than during the previous render".
  // Task #596 hoisted those hooks above the early returns, so the page
  // now renders cleanly even on a cold cache. We keep the wait here
  // anyway to keep the test deterministic, but it's no longer required
  // to avoid the crash.
  await page.waitForLoadState("networkidle");
}

async function selectBuilding(
  page: import("@playwright/test").Page,
  testId: string,
  optionLabel: string | RegExp,
) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionLabel }).click();
}

test.describe("Property detail building filters (Task #590)", () => {
  test("Leases tab Building picker shrinks the lease table to one building and restores it on 'All buildings'", async ({
    page,
  }) => {
    await setupRouteInterception(page);
    await login(page);

    await page.goto(`/properties/${PROPERTY.id}?tab=leases`);
    await page.waitForLoadState("networkidle");

    // Sanity: all four lease rows render before any filter is applied.
    for (const l of ALL_LEASES) {
      await expect(page.getByTestId(`row-lease-${l.id}`)).toBeVisible();
    }

    // Pick Building A → only its two leases should remain.
    await selectBuilding(
      page,
      "select-leases-building-filter",
      /1331 S 8th Ave/,
    );
    await expect(page.getByTestId(`row-lease-${LEASE_A1.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-lease-${LEASE_A2.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-lease-${LEASE_B1.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-lease-${LEASE_B2.id}`)).toHaveCount(0);

    // Pick Building B → only its two leases should remain.
    await selectBuilding(
      page,
      "select-leases-building-filter",
      /1341 S 8th Ave/,
    );
    await expect(page.getByTestId(`row-lease-${LEASE_B1.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-lease-${LEASE_B2.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-lease-${LEASE_A1.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-lease-${LEASE_A2.id}`)).toHaveCount(0);

    // Switch back to All buildings → full list restored.
    await selectBuilding(
      page,
      "select-leases-building-filter",
      /All buildings/,
    );
    for (const l of ALL_LEASES) {
      await expect(page.getByTestId(`row-lease-${l.id}`)).toBeVisible();
    }
  });

  test("Units tab Building picker shrinks the units list to one building and restores it on 'All buildings'", async ({
    page,
  }) => {
    await setupRouteInterception(page);
    await login(page);

    await page.goto(`/properties/${PROPERTY.id}?tab=units`);
    await page.waitForLoadState("networkidle");

    // Sanity: all four unit cards render before filtering.
    for (const u of ["100", "200", "300", "400"]) {
      await expect(page.getByTestId(`unit-card-${u}`)).toBeVisible();
    }

    // Pick Building A → only units 100 and 200 should remain.
    await selectBuilding(
      page,
      "select-units-building-filter",
      /1331 S 8th Ave/,
    );
    await expect(page.getByTestId("unit-card-100")).toBeVisible();
    await expect(page.getByTestId("unit-card-200")).toBeVisible();
    await expect(page.getByTestId("unit-card-300")).toHaveCount(0);
    await expect(page.getByTestId("unit-card-400")).toHaveCount(0);

    // Pick Building B → only units 300 and 400 should remain.
    await selectBuilding(
      page,
      "select-units-building-filter",
      /1341 S 8th Ave/,
    );
    await expect(page.getByTestId("unit-card-300")).toBeVisible();
    await expect(page.getByTestId("unit-card-400")).toBeVisible();
    await expect(page.getByTestId("unit-card-100")).toHaveCount(0);
    await expect(page.getByTestId("unit-card-200")).toHaveCount(0);

    // Switch back to All buildings → full list restored.
    await selectBuilding(
      page,
      "select-units-building-filter",
      /All buildings/,
    );
    for (const u of ["100", "200", "300", "400"]) {
      await expect(page.getByTestId(`unit-card-${u}`)).toBeVisible();
    }
  });

  // Regression test for Task #596. Previously, deep-linking straight to
  // `/properties/:id` on a cold cache crashed PropertyDetail with
  // "Rendered more hooks than during the previous render" because two
  // `useMemo` calls sat below the `isLoading` early return. This test
  // navigates directly to the property page WITHOUT the dashboard
  // warm-up, then asserts the page rendered successfully (header is
  // visible, no global error-boundary fallback shown).
  test("Direct cold-cache navigation to /properties/:id renders without crashing into the error boundary (Task #596)", async ({
    page,
  }) => {
    const errorBoundaryMessages: string[] = [];
    page.on("pageerror", (err) => {
      errorBoundaryMessages.push(err.message);
    });

    await setupRouteInterception(page);

    // Log in but DO NOT wait for the dashboard's queries to settle —
    // we want PropertyDetail to mount mid-load to reproduce the cold-
    // cache scenario the bug originally hit.
    await page.goto("/login");
    await page.getByLabel("Email").fill("pw-cold-load@test.com");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    // Jump straight to the property page without a networkidle wait.
    await page.goto(`/properties/${PROPERTY.id}?tab=leases`);

    // The page should render its content, not the global error
    // boundary. Use a lease row as the success signal — it only
    // appears once PropertyDetail finishes its post-loading render.
    await expect(page.getByTestId(`row-lease-${LEASE_A1.id}`)).toBeVisible();

    // Belt-and-suspenders: no React invariant errors should have
    // surfaced as page errors during the load.
    expect(
      errorBoundaryMessages.filter((m) =>
        m.includes("Rendered more hooks than during the previous render"),
      ),
    ).toEqual([]);
  });
});
