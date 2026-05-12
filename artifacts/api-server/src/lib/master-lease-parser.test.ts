import { describe, it, expect } from "vitest";
import path from "path";
import { promises as fs } from "fs";
import {
  parseAddressCell,
  parseWeeklyCost,
  normalizeCustomerName,
  normalizeAddress,
  levenshtein,
  recognizeStateHeader,
  parseMasterRows,
} from "./master-lease-parser";
import { readMasterWorkbookFromBuffer } from "./import-master-leases";

describe("parseAddressCell", () => {
  it("returns null for blank, TBD, and n/a", () => {
    expect(parseAddressCell("")).toBeNull();
    expect(parseAddressCell("TBD")).toBeNull();
    expect(parseAddressCell("n/a")).toBeNull();
  });

  it("splits a typical street + city/state/zip pair", () => {
    const a = parseAddressCell(
      "600 W Hickory St. Apt.___\r\nGilman, WI 54433",
    );
    expect(a?.city).toBe("Gilman");
    expect(a?.state).toBe("WI");
    expect(a?.zip).toBe("54433");
    expect(a?.street).toMatch(/Hickory/);
    expect(a?.street).not.toMatch(/Apt/i);
  });

  it("captures comma-separated unit numbers tacked to the street", () => {
    const a = parseAddressCell(
      "1850 W Pine St. #_____\r\nBaraboo, WI 53913\r\n509, 510, 512, 811, 812",
    );
    expect(a?.units.split(", ").sort()).toEqual([
      "509",
      "510",
      "512",
      "811",
      "812",
    ]);
    expect(a?.city).toBe("Baraboo");
    expect(a?.state).toBe("WI");
  });

  it("captures Apt N inline with the street line", () => {
    const a = parseAddressCell("1331 South 8th Ave Apt 200\r\nWausau, WI 54401");
    expect(a?.units).toBe("200");
    expect(a?.street).toMatch(/8th Ave/);
    expect(a?.street).not.toMatch(/Apt/i);
  });

  it("extracts an embedded Google Maps URL", () => {
    const a = parseAddressCell(
      "811 Wisconsin Dells Pkwy \r\n Wisconsin Dells, WI53965\r\nhttps://maps.app.goo.gl/abc?g_st=foo",
    );
    expect(a?.mapUrl).toMatch(/^https:\/\/maps\.app\.goo\.gl/);
    expect(a?.zip).toBe("53965");
  });

  it("handles a city/state/zip-only cell", () => {
    const a = parseAddressCell("Bettendorf, IA - 52722");
    // Loose format; state/zip should still parse.
    expect(a?.state).toBe("IA");
    expect(a?.zip).toBe("52722");
  });
});

describe("parseWeeklyCost", () => {
  it("parses clean dollar amounts", () => {
    expect(parseWeeklyCost("$130 ")).toBe(130);
    expect(parseWeeklyCost("$103.43")).toBe(103.43);
    expect(parseWeeklyCost("175")).toBe(175);
  });

  it("returns null for ambiguous / placeholder cells", () => {
    expect(parseWeeklyCost("TBD")).toBeNull();
    expect(parseWeeklyCost("n/a")).toBeNull();
    expect(parseWeeklyCost("$75 or 85")).toBeNull();
    expect(parseWeeklyCost("$69.23???")).toBeNull();
    expect(parseWeeklyCost("$150.50 ($80 fringe to worker and an additional $80 fringe to client)")).toBeNull();
    expect(
      parseWeeklyCost(
        "$98 for more recent starts 60 plus 38 fringe for people who started prior to March and had good attendance",
      ),
    ).toBeNull();
  });
});

describe("normalizeCustomerName", () => {
  it("strips trailing ` - City, ST` suffix", () => {
    expect(normalizeCustomerName("Trienda - Portage, WI")).toBe("trienda");
    expect(normalizeCustomerName("Bell Lumber - Broken Bow, OK")).toBe(
      "bell lumber",
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeCustomerName("SGCG                  ")).toBe("sgcg");
  });
});

describe("normalizeAddress", () => {
  it("normalizes apartment numbering and suffix abbreviations", () => {
    expect(normalizeAddress("600 W Hickory St. Apt 12")).toBe(
      normalizeAddress("600 West Hickory Street #12"),
    );
  });
});

describe("levenshtein", () => {
  it("returns expected distances", () => {
    expect(levenshtein("trienda", "trienda")).toBe(0);
    expect(levenshtein("penda", "trienda")).toBeGreaterThan(2);
    expect(levenshtein("schreiber", "schriber")).toBe(1);
  });
});

describe("recognizeStateHeader", () => {
  it("matches a bare state-name row", () => {
    expect(recognizeStateHeader(["Wisconsin", "", "", ""])).toBe("WI");
    expect(recognizeStateHeader(["North Carolina"])).toBe("NC");
  });
  it("rejects rows with other non-empty cells", () => {
    expect(recognizeStateHeader(["Wisconsin", "$130", ""])).toBeNull();
  });
});

describe("parseMasterRows on the real workbook", () => {
  it("parses the bundled master file into the expected number of customer rows", async () => {
    const filePath = path.resolve(
      __dirname,
      "../../../../attached_assets/Housing_Lease_MASTER_1778105244042.xlsx",
    );
    const buf = await fs.readFile(filePath);
    const rows = readMasterWorkbookFromBuffer(buf);
    const parsed = parseMasterRows(rows);

    // Eight state headers in the file; the rows in between are customers.
    // Adient should be among them, assigned to Missouri.
    const adient = parsed.find((r) => /^adient$/i.test(r.customerName));
    expect(adient).toBeDefined();
    expect(adient?.state).toBe("MO");
    expect(adient?.weeklyCost).toBe(175);

    const orgill = parsed.find((r) => r.customerName === "Orgill");
    expect(orgill).toBeDefined();
    expect(orgill?.weeklyCost).toBeNull();
    expect(orgill?.reviewReasons.length).toBeGreaterThan(0);

    const delallo = parsed.find((r) => r.customerName.startsWith("DeLallo"));
    expect(delallo).toBeDefined();
    expect(delallo?.weeklyCost).toBeNull(); // "$69.23???" is ambiguous
    expect(delallo?.reviewReasons.join(" ")).toMatch(/\$69\.23\?\?\?/);

    const wb = parsed.find((r) => r.customerName.startsWith("WB Manufactoring"));
    expect(wb?.vendor).toBe("Lanyard");
    expect(wb?.complexName).toBe("Hickory Havens Apartments");

    // North Carolina header exists but has no rows after it.
    expect(parsed.every((r) => r.state !== "NC")).toBe(true);
  });
});

describe("parseMasterRows ***Different address*** marker (Task #570)", () => {
  // Build a minimal 22-column row so column F (index 5 = address) and
  // column A (index 0 = customer name / marker) are populated. We need
  // the state header first so `currentState` is set.
  function row(cells: Record<number, string>): string[] {
    const out: string[] = [];
    for (let i = 0; i < 22; i++) out.push(cells[i] ?? "");
    return out;
  }

  it("folds a marker row onto the previous customer as a new BUILDING (not a secondary property)", () => {
    const rows: string[][] = [
      row({ 0: "Header" }), // skipped
      row({ 0: "Wisconsin" }), // state header
      row({
        0: "Schuette Metals",
        1: "$130",
        5: "1331 S 8th Ave\nManitowoc, WI 54220",
      }),
      // Continuation with the marker — should NOT become a secondary property.
      row({
        0: "***Different address***",
        5: "1341 S 8th Ave\nManitowoc, WI 54220",
      }),
    ];
    const parsed = parseMasterRows(rows);
    expect(parsed).toHaveLength(1);
    const schuette = parsed[0]!;
    expect(schuette.customerName).toBe("Schuette Metals");
    expect(schuette.secondary).toBeNull();
    expect(schuette.newBuildings).toHaveLength(1);
    expect(schuette.newBuildings?.[0]?.address.street).toContain("1341");
  });

  it("still treats an unmarked continuation row as a secondary property (legacy behavior)", () => {
    const rows: string[][] = [
      row({ 0: "Header" }),
      row({ 0: "Wisconsin" }),
      row({
        0: "Burnett",
        1: "$130",
        5: "100 Main St\nGrantsburg, WI 54840",
      }),
      // No marker — falls through to the secondary-property branch.
      row({ 5: "200 Other St\nGrantsburg, WI 54840" }),
    ];
    const parsed = parseMasterRows(rows);
    expect(parsed).toHaveLength(1);
    const burnett = parsed[0]!;
    expect(burnett.secondary).not.toBeNull();
    expect(burnett.secondary?.address.street).toContain("200 Other St");
    expect(burnett.newBuildings ?? []).toHaveLength(0);
  });
});
