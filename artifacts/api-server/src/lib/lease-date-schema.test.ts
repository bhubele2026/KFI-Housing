import { describe, expect, it } from "vitest";
import {
  CreateLeaseBody,
  UpdateLeaseBody,
  ImportDataBody,
} from "@workspace/api-zod";

const VALID_LEASE = {
  id: "l1",
  propertyId: "p1",
  startDate: "2024-01-01",
  endDate: "2025-12-31",
  monthlyRent: 4800,
  securityDeposit: 9600,
  status: "Active" as const,
  notes: "",
};

function buildImportPayload(
  leaseOverrides: Partial<typeof VALID_LEASE> = {},
): unknown {
  return {
    customers: [],
    properties: [],
    leases: [{ ...VALID_LEASE, ...leaseOverrides }],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
  };
}

describe("CreateLeaseBody (POST /leases)", () => {
  it("accepts clean ISO date-only strings", () => {
    expect(CreateLeaseBody.safeParse(VALID_LEASE).success).toBe(true);
  });

  it.each([
    ["space + time suffix", "2026-05-31 00:00:00"],
    ["T + time suffix", "2026-05-31T00:00:00"],
    ["full ISO with Z", "2026-05-31T00:00:00.000Z"],
    ["empty string", ""],
    ["non-date garbage", "not-a-date"],
    ["MM/DD/YYYY", "05/31/2026"],
    ["YYYY-M-D (missing zero pad)", "2026-5-31"],
    ["trailing newline", "2026-05-31\n"],
    ["leading whitespace", " 2026-05-31"],
  ])("rejects malformed startDate: %s", (_label, bad) => {
    const result = CreateLeaseBody.safeParse({ ...VALID_LEASE, startDate: bad });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("startDate"),
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects malformed endDate symmetrically", () => {
    const result = CreateLeaseBody.safeParse({
      ...VALID_LEASE,
      endDate: "2026-05-31 00:00:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes("endDate")),
      ).toBe(true);
    }
  });
});

describe("UpdateLeaseBody (PATCH /leases/:id)", () => {
  it("accepts a partial update with a clean date", () => {
    expect(
      UpdateLeaseBody.safeParse({ startDate: "2024-01-01" }).success,
    ).toBe(true);
  });

  it("accepts an empty patch (no date fields)", () => {
    expect(UpdateLeaseBody.safeParse({}).success).toBe(true);
    expect(UpdateLeaseBody.safeParse({ notes: "x" }).success).toBe(true);
  });

  it("rejects a partial update with a stray time suffix on startDate", () => {
    const result = UpdateLeaseBody.safeParse({
      startDate: "2026-05-31 00:00:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a partial update with an ISO Z suffix on endDate", () => {
    const result = UpdateLeaseBody.safeParse({
      endDate: "2026-05-31T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("ImportDataBody.leases (POST /import bundle)", () => {
  it("accepts a bundle whose leases use clean YYYY-MM-DD dates", () => {
    expect(ImportDataBody.safeParse(buildImportPayload()).success).toBe(true);
  });

  it("rejects a bundle whose leases carry a stray time suffix", () => {
    const result = ImportDataBody.safeParse(
      buildImportPayload({ startDate: "2026-05-31 00:00:00" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      // The path should point at the offending lease's startDate, e.g.
      // ["leases", 0, "startDate"]. We just check the leaf is right so this
      // stays robust to wording changes in zod's error format.
      expect(
        result.error.issues.some(
          (i) => i.path[i.path.length - 1] === "startDate",
        ),
      ).toBe(true);
    }
  });

  it("rejects a bundle whose leases have a malformed endDate", () => {
    const result = ImportDataBody.safeParse(
      buildImportPayload({ endDate: "not-a-date" }),
    );
    expect(result.success).toBe(false);
  });
});
