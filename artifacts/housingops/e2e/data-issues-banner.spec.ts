import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the data-issues banner.
 *
 * The banner appears at the top of every authenticated page when the
 * frontend's row-by-row Zod validation (safeParseList) drops one or
 * more rows from an API list response. Each dropped row shows either:
 *   • an "Open" link   — for entity types with a detail page (leases,
 *     properties, customers)
 *   • a "Copy id" button — for entity types without one (rooms, beds,
 *     occupants, utilities)
 *
 * To trigger the banner deterministically we seed malformed rows into
 * the database (NaN monthly_rent → null in JSON → fails z.number())
 * and clean them up after each test.
 */

const MALFORMED_LEASE_ID = "lease-pw-e2e-bad";
const MALFORMED_ROOM_ID = "room-pw-e2e-bad";

test.describe("Data-issues banner", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept the leases API response and append a malformed row.
    // This is more reliable than raw SQL for e2e because the API
    // normalises DB rows before sending them. Route interception lets
    // us inject a row that the frontend's Zod schema will reject.
    await page.route("**/api/leases", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json: unknown[] = await response.json();
      json.push({
        id: MALFORMED_LEASE_ID,
        propertyId: "prop-nonexistent",
        startDate: "2026-03-01",
        endDate: "2026-12-31",
        monthlyRent: "oops",
        securityDeposit: 0,
        status: "Active",
        notes: "",
      });
      await route.fulfill({ json });
    });

    // Intercept the rooms API response and append a malformed row.
    // Rooms have no detail page so the banner shows "Copy id" instead
    // of "Open".
    await page.route("**/api/rooms", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const json: unknown[] = await response.json();
      json.push({
        id: MALFORMED_ROOM_ID,
        propertyId: "prop-nonexistent",
        name: "Ghost Room",
        sqft: 0,
        bathrooms: 0,
        monthlyRent: "oops",
      });
      await route.fulfill({ json });
    });

    // Log in — the app uses a demo auth gate (any email, no password).
    await page.goto("/login");
    await page.getByLabel("Email").fill("pw-e2e@test.com");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Wait for the dashboard to fully load (data fetches fire on mount).
    await page.waitForURL("**/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("clicking Open on a dropped lease row navigates to the lease detail page", async ({
    page,
  }) => {
    // The banner should be visible with the malformed lease row.
    const banner = page.getByTestId("banner-data-issues");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("leases");
    await expect(banner).toContainText("hidden");
    await expect(banner).toContainText(MALFORMED_LEASE_ID);

    // The Open link should point at the lease detail route.
    const openLink = page.getByTestId("data-issue-row-open-leases-0");
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveText("Open");

    // Click and verify navigation.
    await openLink.click();
    await page.waitForURL(`**/leases/${MALFORMED_LEASE_ID}`);
    expect(page.url()).toContain(`/leases/${MALFORMED_LEASE_ID}`);
  });

  test("clicking Copy id on a dropped room row copies the id to the clipboard and shows a toast", async ({
    context,
    page,
  }) => {
    // Grant clipboard permissions so writeText succeeds.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // The banner should show the malformed room row.
    const banner = page.getByTestId("banner-data-issues");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(MALFORMED_ROOM_ID);

    // Rooms don't have a detail page — no Open link, just Copy id.
    await expect(
      page.getByTestId("data-issue-row-open-rooms-0"),
    ).not.toBeVisible();

    const copyBtn = page.getByTestId("data-issue-row-copy-rooms-0");
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toContainText("Copy id");

    // Click and verify toast + clipboard.
    await copyBtn.click();

    // The toast should appear with "Copied" and the room id.
    const toast = page.getByText("Copied");
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText(`Copied id ${MALFORMED_ROOM_ID} to clipboard`),
    ).toBeVisible({ timeout: 5000 });

    // Verify clipboard content.
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toBe(MALFORMED_ROOM_ID);
  });
});
