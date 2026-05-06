// Pulls the source PDF filename out of a lease's notes/clauses so the UI
// can link to it via the api-server's `/api/attached-assets/:filename`
// route (Task #308).
//
// Every seeder under `artifacts/api-server/src/lib/seed-*.ts` stamps the
// originating PDF into the lease as `Source: <filename>.pdf` (or, for a
// few older seeds, `Source document: <filename>.pdf` inside the clauses
// blob). The master-file importer also writes `Source: master file row N.`
// — that's NOT a PDF and must be ignored, hence the `.pdf` suffix in the
// regex.
//
// Only the first matching filename is returned. If a lease is ever cross-
// referenced against multiple PDFs (none today), we'd surface a list
// here instead, but the current data model is one-PDF-per-lease.

// Filenames the seeders write are ASCII-only with letters, digits, and a
// small punctuation set. Keep this in lockstep with `SAFE_FILENAME_RE` in
// the api-server route — anything the regex captures has to round-trip
// successfully through that endpoint.
const SOURCE_PDF_RE = /\bSource(?:\s+document)?:\s*([A-Za-z0-9._,\-+()#@]+\.pdf)\b/i;

export function extractSourcePdfFilename(
  ...texts: ReadonlyArray<string | null | undefined>
): string | null {
  for (const text of texts) {
    if (!text) continue;
    const match = text.match(SOURCE_PDF_RE);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Build the URL operators click to open the original PDF. Always relative
 * (`/api/...`) so it works in dev, production, and tests without any
 * environment plumbing — the same convention every other API call in the
 * housingops bundle uses.
 */
export function sourcePdfHref(filename: string): string {
  return `/api/attached-assets/${encodeURIComponent(filename)}`;
}
