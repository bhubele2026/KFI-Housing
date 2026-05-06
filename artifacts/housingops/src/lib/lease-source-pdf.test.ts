import { describe, it, expect } from "vitest";
import { extractSourcePdfFilename, sourcePdfHref } from "./lease-source-pdf";

describe("extractSourcePdfFilename", () => {
  it("pulls the filename out of a typical seeded lease note", () => {
    const notes =
      "Unit 200, 1331 South 8th Ave, Wausau WI 54401. KFI Staffing LLC. " +
      "Source: Lease_-1331_South_8th_Ave_Apt_200_Wausau,_WI_-_54401_kfi-staff_1778107848648.pdf";
    expect(extractSourcePdfFilename(notes)).toBe(
      "Lease_-1331_South_8th_Ave_Apt_200_Wausau,_WI_-_54401_kfi-staff_1778107848648.pdf",
    );
  });

  it("recognises the older `Source document:` variant used in clauses", () => {
    const clauses =
      "Pets allowed with deposit. Source document: Chateau_Knoll_Lease_-_1407_1778107759430.pdf";
    expect(extractSourcePdfFilename("", clauses)).toBe(
      "Chateau_Knoll_Lease_-_1407_1778107759430.pdf",
    );
  });

  it("falls back to the next text when the first has no source PDF", () => {
    expect(
      extractSourcePdfFilename(
        "Plain notes with no source.",
        "Source: Auto_Zone_-_6481_KFIS_signature_page_-_DeLallo_Lease_5.1.26_KF_1778107208478.pdf",
      ),
    ).toBe(
      "Auto_Zone_-_6481_KFIS_signature_page_-_DeLallo_Lease_5.1.26_KF_1778107208478.pdf",
    );
  });

  it("ignores `Source: master file row N.` from the master importer (not a PDF)", () => {
    const notes =
      "KFI Staffing LLC weekly lease. Source: master file row 42.";
    expect(extractSourcePdfFilename(notes)).toBeNull();
  });

  it("returns null when neither text references a PDF", () => {
    expect(extractSourcePdfFilename("", null, undefined, "no pdf here")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(extractSourcePdfFilename()).toBeNull();
  });
});

describe("sourcePdfHref", () => {
  it("encodes the filename so commas and other punctuation survive", () => {
    expect(
      sourcePdfHref(
        "Yellow_House-_6454_Us-30,_Jeannette,_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
      ),
    ).toBe(
      "/api/attached-assets/Yellow_House-_6454_Us-30%2C_Jeannette%2C_PA_15644_-_2026_KFI_STAFF_1778107208478.pdf",
    );
  });
});
