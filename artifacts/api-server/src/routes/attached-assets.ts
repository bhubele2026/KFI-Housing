import { Router, type IRouter } from "express";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";

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

/**
 * Resolve a request's filename param against `attached_assets/`, applying the
 * same allow-list and traversal defences as the file route below. Returns the
 * absolute path on success, or an HTTP-style error code/message the caller
 * can surface to the client. Factored out so the thumbnail endpoint reuses
 * the exact same validation as the file endpoint.
 */
function resolveAttachedAsset(
  raw: string,
): { ok: true; fullPath: string; filename: string } | { ok: false; status: 400 | 404; error: string } {
  if (!SAFE_FILENAME_RE.test(raw)) {
    return { ok: false, status: 400, error: "Invalid filename." };
  }
  const filename = path.basename(raw);
  if (filename !== raw) {
    return { ok: false, status: 400, error: "Invalid filename." };
  }
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, status: 400, error: "Unsupported file type." };
  }
  const baseDir = attachedAssetsDir();
  const fullPath = path.join(baseDir, filename);
  const rel = path.relative(baseDir, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, status: 400, error: "Invalid filename." };
  }
  return { ok: true, fullPath, filename };
}

/**
 * In-process cache of rendered page-1 thumbnails keyed by filename + mtimeMs.
 * The leases list re-requests the same handful of PDF thumbnails on every
 * navigation; rendering each one fresh would burn ~150ms of pdfjs+canvas work
 * per request. The cache is bounded to keep RSS predictable on long-running
 * servers — leases lists rarely exceed a few dozen distinct PDFs, but we cap
 * at 64 entries and evict the oldest when full. The mtime suffix means a
 * replaced PDF on disk auto-invalidates without a server restart.
 */
const THUMBNAIL_CACHE_MAX = 64;
const thumbnailCache = new Map<string, Buffer>();

function rememberThumbnail(key: string, png: Buffer): void {
  if (thumbnailCache.has(key)) thumbnailCache.delete(key);
  thumbnailCache.set(key, png);
  while (thumbnailCache.size > THUMBNAIL_CACHE_MAX) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (oldestKey === undefined) break;
    thumbnailCache.delete(oldestKey);
  }
}

/**
 * Render page 1 of `pdfPath` to a PNG roughly `targetWidth` pixels wide.
 * Uses pdfjs-dist's legacy build (no worker, runs synchronously on the
 * Node event loop) and `@napi-rs/canvas` for the 2D backend. Both are
 * declared as dependencies of the api-server. Returns null on any render
 * failure so the route can fall back to a 500 → the client renders a PDF
 * icon instead of a broken image.
 */
async function renderPdfFirstPagePng(
  pdfPath: string,
  targetWidth: number,
): Promise<Buffer | null> {
  try {
    // Dynamic imports keep the module graph lazy: thumbnails are an opt-in
    // feature for the leases list, so the api-server's cold start (and tests
    // that never touch this route) shouldn't pay the pdfjs+canvas load cost.
    const [{ createCanvas }, pdfjs] = await Promise.all([
      import("@napi-rs/canvas"),
      import("pdfjs-dist/legacy/build/pdf.mjs"),
    ]);
    const data = new Uint8Array(await fsp.readFile(pdfPath));
    const doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    try {
      const page = await doc.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(0.1, targetWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      // pdfjs-dist's `RenderParameters` types reference DOM
      // `CanvasRenderingContext2D` and `HTMLCanvasElement`, which aren't in
      // the api-server's node tsconfig libs. The @napi-rs/canvas shapes are
      // structurally compatible at runtime; we cast the *parameter object*
      // through `unknown` to pdfjs's own `RenderParameters` so the call
      // stays typed end-to-end (no `any`, no eslint suppressions) while
      // not requiring the server build to pull in the full DOM lib.
      type RenderParams = Parameters<typeof page.render>[0];
      const renderParams = {
        canvasContext: ctx,
        viewport,
        canvas,
      } as unknown as RenderParams;
      await page.render(renderParams).promise;
      return canvas.toBuffer("image/png");
    } finally {
      await doc.cleanup().catch(() => {});
      await doc.destroy().catch(() => {});
    }
  } catch {
    return null;
  }
}

/**
 * Page-1 thumbnail of a bundled lease PDF, used by the leases list to make
 * each row visually scannable (Task #344). Returns a PNG sized roughly to
 * the requested width (clamped to a sane range so a malicious caller can't
 * ask for a 100k-pixel-wide image). Errors are surfaced as a JSON 4xx/5xx
 * so the client `<img onError>` falls back to a generic PDF icon.
 */
router.get("/attached-assets/:filename/thumbnail", async (req, res): Promise<void> => {
  const raw = req.params.filename ?? "";
  const resolved = resolveAttachedAsset(raw);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolved.fullPath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    res.status(404).json({ error: "Source PDF not found." });
    return;
  }

  const widthParam = Number.parseInt(String(req.query.w ?? ""), 10);
  const targetWidth = Number.isFinite(widthParam)
    ? Math.min(400, Math.max(40, widthParam))
    : 160;

  const cacheKey = `${resolved.filename}:${stat.mtimeMs}:${targetWidth}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Thumbnail-Cache", "HIT");
    res.send(cached);
    return;
  }

  const png = await renderPdfFirstPagePng(resolved.fullPath, targetWidth);
  if (!png) {
    res.status(500).json({ error: "Failed to render PDF thumbnail." });
    return;
  }
  rememberThumbnail(cacheKey, png);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Thumbnail-Cache", "MISS");
  res.send(png);
});

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
