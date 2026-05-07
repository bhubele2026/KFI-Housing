import { test, expect, type Route } from "@playwright/test";

/**
 * End-to-end tests for the dashboard layout (Task #479).
 *
 * The dashboard surfaces many cards (KPI tiles, Needs review, Lease
 * expiry alerts, Customer-paid rent, Top properties, Occupancy rate,
 * Financial overview, Property performance) plus several conditional
 * cards driven by API data. As cards get added or removed (Task #478
 * just removed the Pending Placement card), an end-to-end test catches
 * regressions like a missing or broken card on the rendered page.
 *
 * Data is injected via Playwright route interception so the test is
 * deterministic and doesn't depend on real database state. We seed:
 *   - 1 customer
 *   - 1 normal property (with rent) and 1 rent-less property to
 *     trigger the "Properties missing monthly rent" Needs-review tile
 *   - 1 Active lease whose end date is 20 days out, to trigger the
 *     Lease expiry alerts card
 *   - empty insurance certs / payroll / room-night logs so the
 *     payroll-mismatch / low-confidence / recent-reconciliation cards
 *     stay hidden (we assert explicitly on the cards we expect)
 */

const CUSTOMER = {
  id: "c-pw-dash",
  name: "Dash Test Co",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
  state: "",
};

const PROPERTY_DEFAULTS = {
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
  status: "Active" as const,
};

const PROPERTY_WITH_RENT = {
  ...PROPERTY_DEFAULTS,
  id: "prop-pw-dash-1",
  customerId: CUSTOMER.id,
  name: "Maple House",
  address: "1 Maple St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  totalBeds: 1,
  monthlyRent: 1200,
  chargePerBed: 0,
};

// A second property without monthly rent so the Needs-review card
// surfaces the "Properties missing monthly rent" tile.
const PROPERTY_NO_RENT = {
  ...PROPERTY_DEFAULTS,
  id: "prop-pw-dash-2",
  customerId: CUSTOMER.id,
  name: "Oak Cottage",
  address: "2 Oak St",
  city: "Austin",
  state: "TX",
  zip: "78702",
  totalBeds: 1,
  monthlyRent: 0,
  chargePerBed: 0,
};

const ROOM = {
  id: "room-pw-dash",
  propertyId: PROPERTY_WITH_RENT.id,
  name: "Bedroom 1",
  sqft: 100,
  bathrooms: 1,
  monthlyRent: 0,
};

const BED = {
  id: "bed-pw-dash",
  propertyId: PROPERTY_WITH_RENT.id,
  roomId: ROOM.id,
  bedNumber: 1,
  status: "Occupied" as const,
  occupantId: null,
};

function ymd(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const today = new Date();
const startDate = ymd(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000));
// 20 days out → "critical" expiry bucket (≤ 30 days).
const endDate = ymd(new Date(today.getTime() + 20 * 24 * 60 * 60 * 1000));

const EXPIRING_LEASE = {
  id: "lease-pw-dash-expiring",
  propertyId: PROPERTY_WITH_RENT.id,
  startDate,
  endDate,
  monthlyRent: 1200,
  securityDeposit: 0,
  status: "Active",
  notes: "",
  needsReview: false,
  snoozedUntil: "",
};

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
    page.route("**/api/properties", (route) =>
      fulfillJsonGet(route, [PROPERTY_WITH_RENT, PROPERTY_NO_RENT]),
    ),
    page.route("**/api/rooms", (route) => fulfillJsonGet(route, [ROOM])),
    page.route("**/api/beds", (route) => fulfillJsonGet(route, [BED])),
    page.route("**/api/leases", (route) => fulfillJsonGet(route, [EXPIRING_LEASE])),
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

async function loginAndNavigateToDashboard(
  page: import("@playwright/test").Page,
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pw-dashboard@test.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.waitForLoadState("networkidle");
}

test.describe("Dashboard layout (Task #479)", () => {
  test("renders the expected cards and omits the removed Pending Placement card", async ({
    page,
  }) => {
    await setupRouteInterception(page);
    await loginAndNavigateToDashboard(page);

    // ── KPI tiles row ────────────────────────────────────────────────
    // The KPI cards aren't individually testid'd — assert by their
    // visible label so a relabel breaks the test loudly and a missing
    // card breaks it quietly only after the timeout (Playwright will
    // surface that as a clear failure).
    for (const label of [
      "Properties",
      "Total Beds",
      "Occupancy",
      "Monthly Revenue",
      "Monthly Costs",
      "Net Profit",
      "Rent / Bed",
      "Electric / Bed",
      "Rent + Electric / Bed",
    ]) {
      await expect(
        page.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }

    // ── Conditional cards we explicitly seeded data for ─────────────
    await expect(page.getByTestId("card-needs-review")).toBeVisible();
    // The seeded rent-less property surfaces the "Properties missing
    // monthly rent" tile inside Needs review.
    await expect(
      page.getByTestId("tile-needs-review-properties"),
    ).toBeVisible();
    await expect(
      page.getByTestId("text-needs-review-properties-count"),
    ).toHaveText("1");

    // The lease ending in 20 days surfaces the Lease expiry alerts
    // card with a critical-bucket entry.
    await expect(page.getByTestId("card-expiring-leases")).toBeVisible();
    await expect(
      page.getByTestId("text-expiring-leases-total-count"),
    ).toContainText("1 lease");
    await expect(
      page.getByTestId(`row-expiring-lease-${EXPIRING_LEASE.id}`),
    ).toBeVisible();

    // ── Always-visible bottom-of-page cards ─────────────────────────
    await expect(page.getByTestId("card-top-properties")).toBeVisible();
    // Occupancy Rate / Financial Overview / Property Performance
    // aren't testid'd at the Card level, so assert by their visible
    // titles. shadcn's <CardTitle> doesn't render an actual heading
    // tag, so a plain text match is the most reliable selector.
    await expect(
      page.getByText("Occupancy Rate", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Financial Overview", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Property Performance", { exact: true }),
    ).toBeVisible();

    // ── Removed Pending Placement card (Task #478) ──────────────────
    // The dashboard used to render a "Pending placement" KPI/card; it
    // was removed in Task #478. Assert both the testid and the visible
    // label are absent so a regression that re-introduces the card
    // under either form is caught.
    await expect(page.getByTestId("card-pending-placement")).toHaveCount(0);
    await expect(
      page.getByTestId("tile-needs-review-pending-placement"),
    ).toHaveCount(0);
    await expect(page.getByText(/pending placement/i)).toHaveCount(0);

    // ── Cards that should stay hidden because we seeded no data ─────
    // Sanity check that the conditional rendering still works the
    // other way too — these would all render if their data sources
    // had rows.
    await expect(page.getByTestId("card-payroll-mismatches")).toHaveCount(0);
    await expect(page.getByTestId("card-low-confidence-payroll")).toHaveCount(0);
    await expect(page.getByTestId("card-expiring-insurance")).toHaveCount(0);
  });
});
