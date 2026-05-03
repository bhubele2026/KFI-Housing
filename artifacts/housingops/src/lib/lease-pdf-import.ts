// Frontend types and client for the POST /api/leases/import-pdf endpoint.
//
// We mirror the server's response shape here instead of going through the
// generated OpenAPI client because the request is multipart/form-data with a
// PDF file — orval's emitted Blob/File types don't fit our setup, so we own
// this small, hand-written client. We still go through the shared
// `customFetch` wrapper so we pick up the same base-URL handling, bearer
// token injection, and ApiError shape as every other request in the app.

import { customFetch, ApiError } from "@workspace/api-client-react";

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
  /** Free-form summary of notable clauses (pet policy, late fees, etc.). "" when none. */
  clauses: string;
  /** Utilities/services included in rent. Canonical strings preferred (e.g. "Water"). */
  includedItems: string[];
  /** True only when the lease explicitly grants an early-termination buyout option. */
  buyoutAvailable: boolean;
  /** Flat USD buyout fee when stated, else null. Always null when buyoutAvailable is false. */
  buyoutCost: number | null;
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
  const form = new FormData();
  form.append("file", file);

  // We deliberately do NOT set a content-type header — the browser supplies
  // `multipart/form-data; boundary=…` automatically when given a FormData
  // body, and customFetch's "looks like JSON" auto-content-type guard is
  // skipped for non-string bodies.
  try {
    return await customFetch<LeasePdfImportResponse>(
      "/api/leases/import-pdf",
      {
        method: "POST",
        body: form,
        responseType: "json",
      },
    );
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      // Server may have returned `{ error: "..." }`; fall back to the
      // status text otherwise so the toast is never blank.
      const data = err.data as { error?: string } | null;
      const message =
        (data && typeof data.error === "string" && data.error) ||
        `Lease PDF import failed (${err.status}).`;
      throw new LeasePdfImportError(message, err.status);
    }
    throw err;
  }
}
