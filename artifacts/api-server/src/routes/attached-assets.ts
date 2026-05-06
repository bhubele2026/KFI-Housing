import { Router, type IRouter } from "express";
import path from "node:path";
import fs from "node:fs";

/**
 * Read-only static-ish endpoint for serving the bundled lease PDFs that ship
 * under the repo's `attached_assets/` directory. The seeders all stamp the
 * source PDF filename into a lease's notes/clauses (e.g. `Source:
 * Lease_-1331_..._kfi-staff_1778107848648.pdf`); the Leases UI extracts that
 * filename and links here so an operator can open the original document in
 * a new tab without digging through the workspace by hand (Task #308).
 *
 * Why a hand-rolled route instead of `express.static`:
 *   • Restricting to `.pdf` (and a couple of other doc types) keeps any
 *     future xlsx/png/etc. that happen to land in `attached_assets/` from
 *     leaking through this surface.
 *   • Strict filename validation is the only path-traversal defence we
 *     need — the route never accepts subdirectories or `..` segments and
 *     `path.basename` strips any that slip past the validator.
 */
const router: IRouter = Router();

// Resolve the repo's `attached_assets/` once at module load. The api-server
// is started from `artifacts/api-server/` (cwd via package.json scripts), so
// the bundled assets sit two levels up — same convention used by
// `import-master-leases.ts` for the master xlsx workbook.
function attachedAssetsDir(): string {
  return path.resolve(process.cwd(), "..", "..", "attached_assets");
}

// Operator-facing PDFs are the only thing operators link to from the Leases
// UI. Anything else under `attached_assets/` (xlsx exports, screenshots, …)
// is irrelevant to this surface and is rejected so we never broaden the
// blast radius of a leaked URL beyond the lease documents themselves.
const ALLOWED_EXTENSIONS = new Set([".pdf"]);

// Filenames the seeders write are ASCII-only with letters, digits, and a
// small punctuation set (`_`, `-`, `.`, `,`, `(`, `)`, `#`, `+`, `@`). The
// regex pins to that alphabet so a malicious `?filename=../../etc/passwd`
// is rejected before it can reach `path.basename`. We deliberately do NOT
// allow forward slashes or backslashes anywhere in the value.
const SAFE_FILENAME_RE = /^[A-Za-z0-9._,\-+()#@]+$/;

router.get("/attached-assets/:filename", (req, res): void => {
  const raw = req.params.filename ?? "";

  if (!SAFE_FILENAME_RE.test(raw)) {
    res.status(400).json({ error: "Invalid filename." });
    return;
  }

  // `path.basename` is a belt-and-suspenders strip in case the regex above
  // is ever loosened; combined with the regex it makes traversal impossible.
  const filename = path.basename(raw);
  if (filename !== raw) {
    res.status(400).json({ error: "Invalid filename." });
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    res.status(400).json({ error: "Unsupported file type." });
    return;
  }

  const baseDir = attachedAssetsDir();
  const fullPath = path.join(baseDir, filename);

  // Final containment check: the resolved path must still live under
  // `attached_assets/`. This catches symlink-style escapes that the
  // basename + regex pair don't.
  const rel = path.relative(baseDir, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    res.status(400).json({ error: "Invalid filename." });
    return;
  }

  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.status(404).json({ error: "Source PDF not found." });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    // `inline` so browsers render the PDF in a new tab instead of forcing
    // a download. The filename hint lets the user save-as with the
    // original name if they want a local copy.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`,
    );
    res.sendFile(fullPath);
  });
});

export default router;
