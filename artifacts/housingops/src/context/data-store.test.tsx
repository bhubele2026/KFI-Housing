import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeParseList } from "./data-store";
import { LeaseSchema, PropertySchema } from "@/data/mockData";

describe("safeParseList", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeLease(overrides: Record<string, unknown> = {}) {
    return {
      id: "L1",
      propertyId: "P1",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      monthlyRent: 1200,
      securityDeposit: 0,
      status: "Active",
      notes: "",
      ...overrides,
    };
  }

  function makeProperty(overrides: Record<string, unknown> = {}) {
    return {
      id: "P1",
      customerId: "C1",
      name: "Maple House",
      address: "123 Main",
      city: "Austin",
      state: "TX",
      zip: "78701",
      totalBeds: 4,
      monthlyRent: 2400,
      chargePerBed: 600,
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
      notes: "",
      furnishings: [],
      ...overrides,
    };
  }

  it("keeps the good rows from a mixed lease payload and drops the bad one", () => {
    const payload = [
      makeLease({ id: "L1" }),
      // Malformed: monthlyRent should be a number.
      makeLease({ id: "L2", monthlyRent: "oops" }),
      makeLease({ id: "L3" }),
    ];

    const { rows, dropped } = safeParseList(LeaseSchema, payload, "leases");

    expect(rows.map((r) => r.id)).toEqual(["L1", "L3"]);
    expect(dropped).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg] = warnSpy.mock.calls[0];
    expect(String(msg)).toContain("leases");
    expect(String(msg)).toContain("index 1");
  });

  it("keeps the good rows from a mixed property payload and drops the bad one", () => {
    const payload = [
      // Malformed: totalBeds is missing entirely.
      makeProperty({ id: "P-bad", totalBeds: undefined }),
      makeProperty({ id: "P-ok" }),
    ];

    const { rows, dropped } = safeParseList(PropertySchema, payload, "properties");

    expect(rows.map((r) => r.id)).toEqual(["P-ok"]);
    expect(dropped).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns no rows and no warnings for a non-array payload", () => {
    const { rows, dropped } = safeParseList(LeaseSchema, null, "leases");
    expect(rows).toEqual([]);
    expect(dropped).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn or drop when every row parses cleanly", () => {
    const { rows, dropped } = safeParseList(
      LeaseSchema,
      [makeLease({ id: "L1" }), makeLease({ id: "L2" })],
      "leases",
    );
    expect(rows).toHaveLength(2);
    expect(dropped).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the raw payloads of the dropped rows so callers can extract id/labels", () => {
    const bad = makeLease({ id: "L-bad", monthlyRent: "oops", propertyId: "P-9" });
    const { rows, dropped, droppedRaw } = safeParseList(
      LeaseSchema,
      [makeLease({ id: "L1" }), bad, makeLease({ id: "L3" })],
      "leases",
    );

    expect(rows.map((r) => r.id)).toEqual(["L1", "L3"]);
    expect(dropped).toBe(1);
    expect(droppedRaw).toHaveLength(1);
    // The exact same reference (and full payload) is preserved so the
    // banner can pull off id/propertyId/etc. for the inline notice.
    expect(droppedRaw[0]).toBe(bad);
  });
});
