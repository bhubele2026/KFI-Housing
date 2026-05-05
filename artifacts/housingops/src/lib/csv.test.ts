import { describe, it, expect } from "vitest";
import { toCsv, timestampedCsvName } from "./csv";

describe("toCsv", () => {
  it("emits a header row followed by data rows separated by CRLF", () => {
    const csv = toCsv(
      [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }],
      [
        { header: "Name", value: (r) => r.name },
        { header: "Age",  value: (r) => r.age },
      ],
    );
    expect(csv).toBe("Name,Age\r\nAlice,30\r\nBob,25");
  });

  it("quotes cells that contain commas, quotes, or newlines, and doubles inner quotes", () => {
    const csv = toCsv(
      [{ note: 'He said "hi", then left.\nNew line.' }],
      [{ header: "Note", value: (r) => r.note }],
    );
    // The whole field is wrapped in quotes; inner quotes are doubled.
    expect(csv).toBe('Note\r\n"He said ""hi"", then left.\nNew line."');
  });

  it("renders null and undefined values as empty cells", () => {
    const csv = toCsv(
      [{ a: null as string | null, b: undefined as string | undefined }],
      [
        { header: "A", value: (r) => r.a },
        { header: "B", value: (r) => r.b },
      ],
    );
    expect(csv).toBe("A,B\r\n,");
  });

  it("neutralizes leading formula characters to prevent CSV injection", () => {
    const csv = toCsv(
      [
        { v: "=SUM(A1:A2)" },
        { v: "+1+1" },
        { v: "-2+3" },
        { v: "@cmd" },
        { v: "\tTabby" },
        { v: "Safe value" },
      ],
      [{ header: "V", value: (r) => r.v }],
    );
    expect(csv).toBe(
      [
        "V",
        "'=SUM(A1:A2)",
        "'+1+1",
        "'-2+3",
        "'@cmd",
        "'\tTabby",
        "Safe value",
      ].join("\r\n"),
    );
  });

  it("does not treat negative numbers as formulas (numeric values are emitted as-is)", () => {
    const csv = toCsv(
      [{ amount: -42 }],
      [{ header: "Amount", value: (r) => r.amount }],
    );
    expect(csv).toBe("Amount\r\n-42");
  });

  it("emits just the header row when there are no rows", () => {
    const csv = toCsv<{ name: string }>(
      [],
      [{ header: "Name", value: (r) => r.name }],
    );
    expect(csv).toBe("Name");
  });
});

describe("timestampedCsvName", () => {
  it("appends a YYYY-MM-DD-HH-MM-SS stamp and .csv extension", () => {
    const name = timestampedCsvName("housingops-properties");
    expect(name).toMatch(
      /^housingops-properties-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/,
    );
  });
});
