import { describe, expect, it } from "vitest";
import {
  CreateOccupantBody,
  UpdateOccupantBody,
  ImportDataBody,
} from "@workspace/api-zod";

type ValidOccupant = {
  id: string;
  name: string;
  email: string;
  phone: string;
  bedId: string;
  propertyId: string;
  moveInDate: string;
  moveOutDate: string | null;
  status: "Active";
  chargePerBed: number;
  billingFrequency: "Monthly";
  employeeId: string;
  company: string;
};

const VALID_OCCUPANT: ValidOccupant = {
  id: "o1",
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "555-1234",
  bedId: "b1",
  propertyId: "p1",
  moveInDate: "2024-01-15",
  moveOutDate: null,
  status: "Active",
  chargePerBed: 800,
  billingFrequency: "Monthly",
  employeeId: "e1",
  company: "Acme",
};

function buildImportPayload(
  occupantOverrides: Partial<typeof VALID_OCCUPANT> = {},
): unknown {
  return {
    customers: [],
    properties: [],
    leases: [],
    rooms: [],
    beds: [],
    occupants: [{ ...VALID_OCCUPANT, ...occupantOverrides }],
    utilities: [],
  };
}

// Strings that must be rejected on every occupant write path. Note that the
// empty string is intentionally NOT in this list: the OptionalLeaseDate
// schema (see lib/api-spec/openapi.yaml) deliberately accepts "" so legacy
// import payloads — where occupants were imported without a known move-in
// date — keep round-tripping. The "accepts an empty-string ... date" cases
// below pin that contract so it can't silently regress.
const MALFORMED_DATES: ReadonlyArray<readonly [string, string]> = [
  ["space + time suffix", "2024-01-15 00:00:00"],
  ["T + time suffix", "2024-01-15T00:00:00"],
  ["full ISO with Z", "2024-01-15T00:00:00.000Z"],
  ["non-date garbage", "not-a-date"],
  ["MM/DD/YYYY", "01/15/2024"],
  ["YYYY-M-D (missing zero pad)", "2024-1-15"],
  ["trailing newline", "2024-01-15\n"],
  ["leading whitespace", " 2024-01-15"],
];

describe("CreateOccupantBody (POST /occupants)", () => {
  it("accepts a clean YYYY-MM-DD moveInDate with null moveOutDate", () => {
    expect(CreateOccupantBody.safeParse(VALID_OCCUPANT).success).toBe(true);
  });

  it("accepts a clean YYYY-MM-DD moveOutDate", () => {
    expect(
      CreateOccupantBody.safeParse({
        ...VALID_OCCUPANT,
        moveOutDate: "2025-06-30",
      }).success,
    ).toBe(true);
  });

  // OptionalLeaseDate intentionally permits "" (see openapi.yaml). These two
  // cases pin that contract: occupants imported without a known move-in /
  // move-out date are stored as "" and must round-trip through the API.
  it("accepts an empty-string moveInDate (legacy/imported records)", () => {
    expect(
      CreateOccupantBody.safeParse({ ...VALID_OCCUPANT, moveInDate: "" })
        .success,
    ).toBe(true);
  });

  it("accepts an empty-string moveOutDate (legacy/imported records)", () => {
    expect(
      CreateOccupantBody.safeParse({ ...VALID_OCCUPANT, moveOutDate: "" })
        .success,
    ).toBe(true);
  });

  it.each(MALFORMED_DATES)(
    "rejects malformed moveInDate: %s",
    (_label, bad) => {
      const result = CreateOccupantBody.safeParse({
        ...VALID_OCCUPANT,
        moveInDate: bad,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes("moveInDate")),
        ).toBe(true);
      }
    },
  );

  it.each(MALFORMED_DATES)(
    "rejects malformed moveOutDate: %s",
    (_label, bad) => {
      const result = CreateOccupantBody.safeParse({
        ...VALID_OCCUPANT,
        moveOutDate: bad,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes("moveOutDate")),
        ).toBe(true);
      }
    },
  );
});

describe("UpdateOccupantBody (PATCH /occupants/:id)", () => {
  it("accepts an empty patch", () => {
    expect(UpdateOccupantBody.safeParse({}).success).toBe(true);
  });

  it("accepts a partial update with a clean moveInDate", () => {
    expect(
      UpdateOccupantBody.safeParse({ moveInDate: "2024-01-15" }).success,
    ).toBe(true);
  });

  it("accepts a partial update clearing moveOutDate to null", () => {
    expect(UpdateOccupantBody.safeParse({ moveOutDate: null }).success).toBe(
      true,
    );
  });

  it("accepts a partial update with a clean moveOutDate", () => {
    expect(
      UpdateOccupantBody.safeParse({ moveOutDate: "2025-06-30" }).success,
    ).toBe(true);
  });

  it("rejects a partial update with a stray time suffix on moveInDate", () => {
    const result = UpdateOccupantBody.safeParse({
      moveInDate: "2024-01-15 00:00:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a partial update with an ISO Z suffix on moveOutDate", () => {
    const result = UpdateOccupantBody.safeParse({
      moveOutDate: "2024-01-15T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a partial update with MM/DD/YYYY moveOutDate", () => {
    const result = UpdateOccupantBody.safeParse({
      moveOutDate: "01/15/2024",
    });
    expect(result.success).toBe(false);
  });
});

describe("ImportDataBody.occupants (POST /import bundle)", () => {
  it("accepts a bundle whose occupants use clean YYYY-MM-DD dates", () => {
    expect(ImportDataBody.safeParse(buildImportPayload()).success).toBe(true);
  });

  it("accepts a bundle whose occupant has a clean moveOutDate", () => {
    expect(
      ImportDataBody.safeParse(
        buildImportPayload({ moveOutDate: "2025-06-30" }),
      ).success,
    ).toBe(true);
  });

  it("rejects a bundle whose occupant carries a stray time suffix on moveInDate", () => {
    const result = ImportDataBody.safeParse(
      buildImportPayload({ moveInDate: "2024-01-15 00:00:00" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path[i.path.length - 1] === "moveInDate",
        ),
      ).toBe(true);
    }
  });

  it("rejects a bundle whose occupant has an ISO Z moveOutDate", () => {
    const result = ImportDataBody.safeParse(
      buildImportPayload({ moveOutDate: "2024-01-15T00:00:00.000Z" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path[i.path.length - 1] === "moveOutDate",
        ),
      ).toBe(true);
    }
  });

  it("rejects a bundle whose occupant has an MM/DD/YYYY moveInDate", () => {
    const result = ImportDataBody.safeParse(
      buildImportPayload({ moveInDate: "01/15/2024" }),
    );
    expect(result.success).toBe(false);
  });
});
