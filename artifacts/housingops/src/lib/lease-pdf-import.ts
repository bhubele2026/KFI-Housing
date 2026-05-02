// Frontend types and client for the POST /api/leases/import-pdf endpoint.
//
// We mirror the server's response shape here instead of going through the
// generated OpenAPI client because the request is multipart/form-data with a
// PDF file — orval's emitted Blob/File types don't fit our setup, so we own
// this small, hand-written client.

export type LeasePdfConfidence = "high" | "medium" | "low";

export interface ExtractedLeaseFromPdf {
  propertyName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  landlordName: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRent: number | null;
  securityDeposit: number | null;
  notes: string;
  confidence: LeasePdfConfidence;
}

export interface PropertyMatchCandidate {
  propertyId: string;
  propertyName: string;
  address: string;
  city: string;
  state: string;
  customerName: string;
  /** 0..1, higher is a better match. */
  score: number;
}

export interface LeasePdfImportResponse {
  extracted: ExtractedLeaseFromPdf;
  /** Best match when its score is comfortably above the noise floor (>=0.6); null otherwise. */
  topMatch: PropertyMatchCandidate | null;
  /** Up to 5 best candidates, sorted by score desc. May be empty. */
  candidates: PropertyMatchCandidate[];
}

export class LeasePdfImportError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LeasePdfImportError";
    this.status = status;
  }
}

/**
 * Upload a single lease PDF for parsing + property matching.
 *
 * Throws {@link LeasePdfImportError} on any non-2xx response so callers can
 * surface the server's user-friendly message in a toast.
 */
export async function importLeasePdf(
  file: File,
): Promise<LeasePdfImportResponse> {
  // BASE_URL is "/" for housingops, but the /api prefix is owned by the
  // platform router that maps it to the api-server artifact — so we hit
  // a root-relative URL directly. Same pattern the generated api client uses.
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/leases/import-pdf", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!res.ok) {
    let message = `Lease PDF import failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    throw new LeasePdfImportError(message, res.status);
  }

  return (await res.json()) as LeasePdfImportResponse;
}
