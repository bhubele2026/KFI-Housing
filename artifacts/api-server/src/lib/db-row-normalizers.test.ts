import { describe, expect, it } from "vitest";
import {
  normalizeLeaseDate,
  normalizeLeaseRow,
  normalizePropertyRow,
  normalizeCustomerRow,
} from "./db-row-normalizers";

describe("normalizeLeaseDate", () => {
  it.each([
    ["already canonical", "2026-05-31", "2026-05-31"],
    ["space + time", "2026-05-31 00:00:00", "2026-05-31"],
    ["T + time + Z", "2026-05-31T00:00:00.000Z", "2026-05-31"],
    ["T + time, no zone", "2026-05-31T00:00:00", "2026-05-31"],
    ["empty string", "", ""],
  ])("coerces %s -> canonical YYYY-MM-DD", (_label, input, expected) => {
    expect(normalizeLeaseDate(input)).toBe(expected);
  });

  it("maps null/undefined to empty string", () => {
    expect(normalizeLeaseDate(null)).toBe("");
    expect(normalizeLeaseDate(undefined)).toBe("");
  });

  it("passes through unrecognised strings unchanged so the schema still flags them", () => {
    expect(normalizeLeaseDate("not-a-date")).toBe("not-a-date");
  });
});

describe("normalizePropertyRow", () => {
  it("coerces unknown paymentMethod to blank but preserves known members", () => {
    expect(normalizePropertyRow({ paymentMethod: "Cash" })).toEqual({
      paymentMethod: "",
    });
    expect(normalizePropertyRow({ paymentMethod: "ACH" })).toEqual({
      paymentMethod: "ACH",
    });
    expect(normalizePropertyRow({ paymentMethod: "Invoice" })).toEqual({
      paymentMethod: "Invoice",
    });
    expect(normalizePropertyRow({ paymentMethod: "" })).toEqual({
      paymentMethod: "",
    });
  });

  it("coerces unknown status to Active and preserves known members", () => {
    expect(normalizePropertyRow({ status: "Pending" as never })).toEqual({
      status: "Active",
    });
    expect(normalizePropertyRow({ status: "Inactive" })).toEqual({
      status: "Inactive",
    });
  });

  it("coerces unknown rentFrequency to Monthly", () => {
    expect(normalizePropertyRow({ rentFrequency: "Annually" as never })).toEqual(
      { rentFrequency: "Monthly" },
    );
    expect(normalizePropertyRow({ rentFrequency: "Weekly" })).toEqual({
      rentFrequency: "Weekly",
    });
  });

  it("leaves untouched fields alone (partial PATCH safety)", () => {
    expect(normalizePropertyRow({ name: "X", totalBeds: 4 })).toEqual({
      name: "X",
      totalBeds: 4,
    });
  });
});

describe("normalizeLeaseRow", () => {
  it("normalizes term dates and coerces unknown status / rateType", () => {
    expect(
      normalizeLeaseRow({
        startDate: "2026-05-31 00:00:00",
        endDate: "2027-05-31T00:00:00.000Z",
        status: "pending" as never,
        rateType: "annual" as never,
      }),
    ).toEqual({
      startDate: "2026-05-31",
      endDate: "2027-05-31",
      status: "Active",
      rateType: "monthly",
    });
  });

  it("maps null term dates to blank (legacy DB rows where the column was nullable)", () => {
    // Cast: production DB rows occasionally contain nulls for these
    // columns even though the current InsertLeaseRow type narrows
    // them to string. The normalizer must defensively coerce.
    expect(
      normalizeLeaseRow({
        startDate: null as unknown as string,
        endDate: null as unknown as string,
      }),
    ).toEqual({ startDate: "", endDate: "" });
  });

  it("preserves known status and rateType members", () => {
    expect(
      normalizeLeaseRow({ status: "Expired", rateType: "room-night" }),
    ).toEqual({ status: "Expired", rateType: "room-night" });
  });

  it("leaves rent / notes / unrelated fields alone", () => {
    expect(normalizeLeaseRow({ monthlyRent: 1200, notes: "hi" })).toEqual({
      monthlyRent: 1200,
      notes: "hi",
    });
  });
});

describe("normalizeCustomerRow", () => {
  it("returns a shallow copy (pass-through today)", () => {
    const input = { id: "c1", name: "Acme", state: "IA" };
    const out = normalizeCustomerRow(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});
