import { test, expect } from "@playwright/test";

/**
 * End-to-end test for the dashboard's duplicate-occupant guard (Task #349).
 *
 * When an Unplaced Payroll row's personId matches an existing occupant's
 * employeeId — typically one seeded into a "Roster — Pending Placement"
 * bucket — the dashboard must show "Open pending bucket" instead of
 * "Assign to bed". Following that link lands on the bucket page where the
 * operator can move the EXISTING occupant to a real bed without spawning a
 * duplicate.
 *
 * Data is injected via Playwright route interception so the test is
 * deterministic and doesn't depend on real database state.
 */

const CUSTOMER = {
  id: "c-pw-dup",
  name: "PW Guard Co",
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
};

const PENDING_PROPERTY = {
  ...PROPERTY_DEFAULTS,
  id: "pp-pw-dup",
  customerId: CUSTOMER.id,
  name: "Roster — Pending Placement (PW Guard Co)",
  address: "",
  city: "",
  state: "",
  zip: "",
  totalBeds: 0,
  monthlyRent: 0,
  chargePerBed: 0,
  status: "Active" as const,
  paymentNotes: "",
  notes: "",
};

const REAL_PROPERTY = {
  ...PROPERTY_DEFAULTS,
  id: "rp-pw-dup",
  customerId: CUSTOMER.id,
  name: "Elm Court",
  address: "10 Elm St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  totalBeds: 1,
  monthlyRent: 1000,
  chargePerBed: 0,
  status: "Active" as const,
  paymentNotes: "",
  notes: "",
};

const ROOM = {
  id: "room-pw-dup",
  propertyId: REAL_PROPERTY.id,
  name: "Bedroom 1",
  sqft: 100,
  bathrooms: 1,
  monthlyRent: 0,
};

const VACANT_BED = {
  id: "bed-pw-dup",
  propertyId: REAL_PROPERTY.id,
  roomId: ROOM.id,
  bedNumber: 1,
  status: "Vacant" as const,
  occupantId: null,
};

const PENDING_OCCUPANT = {
  id: "occ-pw-dup",
  propertyId: PENDING_PROPERTY.id,
  bedId: null,
  name: "Jane Doe",
  employeeId: "EMP-PW-1",
  company: CUSTOMER.name,
  moveInDate: "",
  moveOutDate: null,
  status: "Active" as const,
  chargePerBed: 150,
  billingFrequency: "Weekly" as const,
  email: "",
  phone: "",
  chargeSource: "" as const,
  chargeSourceCustomer: "",
  chargeSourcePersonId: "",
  shift: null,
};

const UNPLACED_PAYROLL_ROW = {
  customer: CUSTOMER.name,
  personId: "EMP-PW-1",
  name: "Jane Doe",
  weekly: 150,
  suggestions: [],
};

function setupRouteInterception(
  page: import("@playwright/test").Page,
  apiLog: Array<{ method: string; url: string; body?: unknown }>,
) {
  function captureWrite(route: import("@playwright/test").Route) {
    const method = route.request().method();
    const url = route.request().url();
    let body: unknown;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = route.request().postData();
    }
    apiLog.push({ method, url, body });
  }

  return Promise.all([
    page.route("**/api/customers", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json: unknown[] = await response.json();
      json.push(CUSTOMER);
      await route.fulfill({ json });
    }),

    page.route("**/api/properties", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        const response = await route.fetch();
        const json: unknown[] = await response.json();
        json.push(PENDING_PROPERTY, REAL_PROPERTY);
        await route.fulfill({ json });
      } else if (method === "DELETE") {
        captureWrite(route);
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/rooms", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json: unknown[] = await response.json();
      json.push(ROOM);
      await route.fulfill({ json });
    }),

    page.route("**/api/beds", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        const response = await route.fetch();
        const json: unknown[] = await response.json();
        json.push(VACANT_BED);
        await route.fulfill({ json });
      } else if (method === "PATCH") {
        captureWrite(route);
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/occupants", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        const response = await route.fetch();
        const json: unknown[] = await response.json();
        json.push(PENDING_OCCUPANT);
        await route.fulfill({ json });
      } else if (method === "PATCH" || method === "POST") {
        captureWrite(route);
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/payroll/unplaced", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        json: {
          unmatched: [UNPLACED_PAYROLL_ROW],
          lowConfidenceMatches: [],
        },
      });
    }),

    page.route("**/api/occupants/*", async (route) => {
      const method = route.request().method();
      if (method === "PATCH" || method === "POST") {
        captureWrite(route);
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/beds/*", async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        captureWrite(route);
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.continue();
      }
    }),

    page.route("**/api/properties/*", async (route) => {
      const method = route.request().method();
      if (method === "DELETE") {
        captureWrite(route);
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.continue();
      }
    }),
  ]);
}

async function loginAndNavigateToDashboard(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pw-dup-guard@test.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.waitForLoadState("networkidle");
}

test.describe("Dashboard duplicate-occupant guard (Task #349)", () => {
  test("shows 'Open pending bucket' instead of 'Assign to bed' for a payroll row with an existing pending-placement occupant", async ({
    page,
  }) => {
    const apiLog: Array<{ method: string; url: string; body?: unknown }> = [];
    await setupRouteInterception(page, apiLog);
    await loginAndNavigateToDashboard(page);

    const unplacedCard = page.getByTestId("card-unplaced-payroll");
    await expect(unplacedCard).toBeVisible();

    const openBtn = page.getByTestId(
      `button-open-existing-unplaced-${UNPLACED_PAYROLL_ROW.personId}`,
    );
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toContainText("Open pending bucket");
    await expect(openBtn).toHaveAttribute("data-existing-pending", "1");
    await expect(openBtn).toHaveAttribute(
      "data-existing-occupant-id",
      PENDING_OCCUPANT.id,
    );

    const assignBtn = page.getByTestId(
      `button-assign-unplaced-${UNPLACED_PAYROLL_ROW.personId}`,
    );
    await expect(assignBtn).not.toBeVisible();
  });

  test("full flow: dashboard → bucket page → Move-to-bed updates the existing occupant without spawning a duplicate", async ({
    page,
  }) => {
    const apiLog: Array<{ method: string; url: string; body?: unknown }> = [];
    await setupRouteInterception(page, apiLog);
    await loginAndNavigateToDashboard(page);

    const openBtn = page.getByTestId(
      `button-open-existing-unplaced-${UNPLACED_PAYROLL_ROW.personId}`,
    );
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    await page.waitForURL(`**/properties/${PENDING_PROPERTY.id}`);
    expect(page.url()).toContain(`/properties/${PENDING_PROPERTY.id}`);

    const board = page.getByTestId("pending-placement-board");
    await expect(board).toBeVisible();

    const pendingRow = page.getByTestId(
      `pending-placement-row-${PENDING_OCCUPANT.id}`,
    );
    await expect(pendingRow).toBeVisible();

    const nameEl = page.getByTestId(`pending-name-${PENDING_OCCUPANT.id}`);
    await expect(nameEl).toContainText("Jane Doe");

    const moveBtn = page.getByTestId(
      `pending-move-button-${PENDING_OCCUPANT.id}`,
    );
    await expect(moveBtn).toBeDisabled();

    const propertyTrigger = page.getByTestId(
      `pending-property-select-${PENDING_OCCUPANT.id}`,
    );
    await propertyTrigger.click();
    await page.getByRole("option", { name: /Elm Court/i }).click();

    const bedTrigger = page.getByTestId(
      `pending-bed-select-${PENDING_OCCUPANT.id}`,
    );
    await bedTrigger.click();
    await page.getByRole("option", { name: /Bed 1/i }).click();

    await expect(moveBtn).toBeEnabled();

    apiLog.length = 0;
    await moveBtn.click();

    await page.waitForTimeout(1000);

    const occupantPatches = apiLog.filter(
      (r) => r.method === "PATCH" && r.url.includes("/api/occupants"),
    );
    const occupantPosts = apiLog.filter(
      (r) => r.method === "POST" && r.url.includes("/api/occupants"),
    );

    expect(occupantPosts).toHaveLength(0);

    expect(occupantPatches.length).toBeGreaterThanOrEqual(1);
    const movePatch = occupantPatches.find((r) =>
      r.url.includes(`/api/occupants/${PENDING_OCCUPANT.id}`),
    );
    expect(movePatch).toBeDefined();

    const patchBody = movePatch!.body as Record<string, unknown>;
    expect(patchBody.propertyId).toBe(REAL_PROPERTY.id);
    expect(patchBody.bedId).toBe(VACANT_BED.id);
    expect(typeof patchBody.moveInDate).toBe("string");

    const bedPatches = apiLog.filter(
      (r) => r.method === "PATCH" && r.url.includes(`/api/beds/${VACANT_BED.id}`),
    );
    expect(bedPatches.length).toBeGreaterThanOrEqual(1);
    const bedPatch = bedPatches[0]!.body as Record<string, unknown>;
    expect(bedPatch.status).toBe("Occupied");
    expect(bedPatch.occupantId).toBe(PENDING_OCCUPANT.id);

    const bucketDeletes = apiLog.filter(
      (r) =>
        r.method === "DELETE" &&
        r.url.includes(`/api/properties/${PENDING_PROPERTY.id}`),
    );
    expect(bucketDeletes.length).toBeGreaterThanOrEqual(1);
  });
});
