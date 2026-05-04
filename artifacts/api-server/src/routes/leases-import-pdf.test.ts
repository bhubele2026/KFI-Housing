import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import express, { type Express } from "express";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
//
// The route transitively imports:
//   * @workspace/db                — throws at import if DATABASE_URL unset
//   * @workspace/integrations-anthropic-ai — throws at import if AI env unset
//
// Both are network-y singletons we don't want in a fast unit test. Mock them
// before the route module is imported.

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: { create: vi.fn() },
  },
}));

const dbSelectMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: dbSelectMock }),
  },
  customersTable: { __table: "customers" },
  propertiesTable: { __table: "properties" },
}));

// Mock just the LLM call so the route + matcher run end-to-end with a known
// extraction shape. Keep the rest of the module (rankPropertyCandidates,
// schema) real so we exercise the real wiring.
vi.mock("../lib/lease-pdf-import", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/lease-pdf-import")
  >("../lib/lease-pdf-import");
  return {
    ...actual,
    extractLeaseFromText: vi.fn(),
  };
});

// Imports come AFTER the mocks above so the mocked modules are picked up.
const { extractLeaseFromText } = await import("../lib/lease-pdf-import");
const leasesImportPdfRouter = (await import("./leases-import-pdf")).default;

// ---------------------------------------------------------------------------
// Tiny test-only PDF fixture
// ---------------------------------------------------------------------------
//
// A hand-crafted, single-page PDF whose extracted text is comfortably above
// the route's 50-character minimum. We keep it inline so the test has no
// fixture-file dependencies.
function makeTestPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n" +
      "4 0 obj << /Length 200 >> stream\n" +
      "BT /F1 12 Tf 50 750 Td " +
      "(Residential Lease Agreement Maple Court Apartments 4800 USD per month) Tj " +
      "0 -20 Td (Tenant John Doe Landlord ACME Properties LLC 90210) Tj ET\n" +
      "endstream endobj\n" +
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n" +
      "xref\n0 6\n0000000000 65535 f\n" +
      "0000000010 00000 n\n0000000055 00000 n\n0000000100 00000 n\n" +
      "0000000185 00000 n\n0000000260 00000 n\n" +
      "trailer << /Size 6 /Root 1 0 R >>\n" +
      "startxref\n320\n%%EOF\n",
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// One ephemeral HTTP server for the whole suite
// ---------------------------------------------------------------------------

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const app: Express = express();
  app.use("/api", leasesImportPdfRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  vi.mocked(extractLeaseFromText).mockReset();
  dbSelectMock.mockReset();
});

async function postPdf(body: FormData): Promise<Response> {
  return fetch(`${baseUrl}/api/leases/import-pdf`, {
    method: "POST",
    body,
  });
}

function pdfFormData(
  buffer: Buffer,
  options: { filename?: string; type?: string } = {},
): FormData {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], {
      type: options.type ?? "application/pdf",
    }),
    options.filename ?? "lease.pdf",
  );
  return form;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/leases/import-pdf", () => {
  it("returns the parsed lease + ranked candidates on a happy-path upload", async () => {
    vi.mocked(extractLeaseFromText).mockResolvedValue({
      propertyName: "Maple Court Apartments",
      propertyAddress: "123 Maple St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      landlordName: "ACME Properties LLC",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      monthlyRent: 4800,
      securityDeposit: 4800,
      notes: "12-month residential lease.",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
      confidence: "high",
    });

    // Two .from() calls (properties, customers) in the route — return the
    // matching property first, customers second.
    dbSelectMock
      .mockResolvedValueOnce([
        {
          id: "prop-1",
          name: "Maple Court Apartments",
          address: "123 Maple St",
          city: "Austin",
          state: "TX",
          zip: "78701",
          customerId: "cust-1",
        },
      ])
      .mockResolvedValueOnce([{ id: "cust-1", name: "ACME Properties LLC" }]);

    const res = await postPdf(pdfFormData(makeTestPdfBuffer()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      extracted: { propertyName: string; monthlyRent: number };
      topMatch: { propertyId: string; score: number } | null;
      candidates: Array<{ propertyId: string; score: number }>;
    };

    // Shape matches the public LeasePdfImportResponse contract.
    expect(body).toMatchObject({
      extracted: {
        propertyName: "Maple Court Apartments",
        monthlyRent: 4800,
      },
    });
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0]?.propertyId).toBe("prop-1");
    expect(body.topMatch?.propertyId).toBe("prop-1");
    expect(body.topMatch?.score).toBeGreaterThanOrEqual(0.6);

    // The LLM was actually invoked with the parsed PDF text.
    expect(extractLeaseFromText).toHaveBeenCalledTimes(1);
    const passedText = vi.mocked(extractLeaseFromText).mock.calls[0]?.[0] ?? "";
    expect(passedText).toContain("Maple Court Apartments");
  });

  it("returns 400 when no 'file' field is sent", async () => {
    const empty = new FormData();
    empty.append("not-the-file", "x");
    const res = await postPdf(empty);
    expect(res.status).toBe(400);
    expect(extractLeaseFromText).not.toHaveBeenCalled();
  });

  it("returns 415 when the upload mime is wrong AND the filename isn't .pdf", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(Buffer.from("hello world"))], {
        type: "text/plain",
      }),
      "lease.txt",
    );

    const res = await postPdf(form);
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/PDF/i);
    expect(extractLeaseFromText).not.toHaveBeenCalled();
  });

  it("returns 422 when the PDF parses but contains no readable text", async () => {
    // pdf-parse returns very little text for tiny/empty PDFs. Use a bytes-
    // only PDF whose extracted text is well under the 50-char threshold.
    const tinyPdf = Buffer.from(
      "%PDF-1.4\n" +
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n" +
        "xref\n0 4\n0000000000 65535 f\n" +
        "0000000010 00000 n\n0000000055 00000 n\n0000000100 00000 n\n" +
        "trailer << /Size 4 /Root 1 0 R >>\n" +
        "startxref\n160\n%%EOF\n",
      "utf8",
    );

    const res = await postPdf(pdfFormData(tinyPdf));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/text|scanned|OCR/i);
    expect(extractLeaseFromText).not.toHaveBeenCalled();
  });

  it("returns 422 when pdf-parse cannot parse the bytes at all", async () => {
    // Garbage bytes with a .pdf name + PDF mime — passes the mime gate, fails
    // pdf-parse, should map to 422 (unprocessable entity).
    const garbage = Buffer.from("this is definitely not a pdf file at all", "utf8");
    const res = await postPdf(pdfFormData(garbage));
    expect(res.status).toBe(422);
    expect(extractLeaseFromText).not.toHaveBeenCalled();
  });

  it("returns 413 when the upload exceeds the 10 MB cap", async () => {
    // 10 MB + 1 byte of zero-fill — multer rejects on size before any
    // PDF parsing is even attempted.
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const res = await postPdf(pdfFormData(oversized));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/too large|MB/i);
    expect(extractLeaseFromText).not.toHaveBeenCalled();
  }, 20_000);

  it("returns 502 when the LLM extractor throws", async () => {
    vi.mocked(extractLeaseFromText).mockRejectedValueOnce(
      new Error("anthropic 503 unavailable"),
    );
    // db.select shouldn't actually be hit — the route returns before that —
    // but if it is, return empty arrays so the route doesn't throw.
    dbSelectMock.mockResolvedValue([]);

    const res = await postPdf(pdfFormData(makeTestPdfBuffer()));

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/extract/i);
  });

  it("returns topMatch=null when no candidate clears the noise floor", async () => {
    vi.mocked(extractLeaseFromText).mockResolvedValue({
      propertyName: "Some Random Building",
      propertyAddress: "Some Random Address",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
      landlordName: null,
      startDate: null,
      endDate: null,
      monthlyRent: null,
      securityDeposit: null,
      notes: "",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
      confidence: "low",
    });

    // A property that won't share enough tokens to clear 0.6.
    dbSelectMock
      .mockResolvedValueOnce([
        {
          id: "prop-other",
          name: "Riverside Lofts",
          address: "9 River Rd",
          city: "Dallas",
          state: "TX",
          zip: "75201",
          customerId: "cust-1",
        },
      ])
      .mockResolvedValueOnce([{ id: "cust-1", name: "Other LLC" }]);

    const res = await postPdf(pdfFormData(makeTestPdfBuffer()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      topMatch: unknown;
      candidates: unknown[];
    };
    expect(body.topMatch).toBeNull();
  });
});
