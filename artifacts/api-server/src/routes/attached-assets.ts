import { Router, type IRouter } from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { objectStorageClient } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Object Storage fallback for bundled `attached_assets/` (Task #640).
 *
 * Republishing the app gives the container a fresh local filesystem,
 * so any PDF that landed under `attached_assets/` after the last
 * build is gone the moment the user republishes. To make the read
 * path republish-safe, we:
 *
 *   1. Serve from local disk first (fast, no network hop).
 *   2. On miss, fall back to a `legacy-attached-assets/<filename>`
 *      object in the configured Object Storage bucket.
 *   3. Stream the object body back to disk in the bucket-served case
 *      so subsequent reads (and the thumbnail cache) are warm again.
 *
 * The one-time backfill (`backfillAttachedAssetsToObjectStorage`)
 * uploads anything on local disk into Object Storage so a republish
 * later finds the same set of files there.
 */
const ATTACHED_ASSETS_PREFIX = "legacy-attached-assets/";

function objectStorageBucketName(): string | null {
  const dir = process.env.PRIVATE_OBJECT_DIR;
  if (!dir || dir.trim() === "") return null;
  const trimmed = dir.replace(/^\/+/, "");
  const bucket = trimmed.split("/")[0];
  return bucket || null;
}

function objectStoragePrefix(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const trimmed = dir.replace(/^\/+/, "");
  const parts = trimmed.split("/").filter((p) => p.length > 0);
  const subPath = parts.slice(1).join("/");
  return subPath
    ? `${subPath}/${ATTACHED_ASSETS_PREFIX}`
    : ATTACHED_ASSETS_PREFIX;
}

async function downloadFromObjectStorage(filename: string): Promise<Buffer | null> {
  const bucketName = objectStorageBucketName();
  if (!bucketName) return null;
  try {
    const file = objectStorageClient
      .bucket(bucketName)
      .file(`${objectStoragePrefix()}${filename}`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return buf;
  } catch (err) {
    logger.warn(
      { err, filename },
      "Object Storage fallback download failed for attached asset",
    );
    return null;
  }
}

async function uploadToObjectStorage(
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const bucketName = objectStorageBucketName();
  if (!bucketName) return false;
  try {
    const file = objectStorageClient
      .bucket(bucketName)
      .file(`${objectStoragePrefix()}${filename}`);
    await file.save(body, { resumable: false, contentType });
    return true;
  } catch (err) {
    logger.warn(
      { err, filename },
      "Object Storage upload failed for attached asset",
    );
    return false;
  }
}

async function restoreAssetToDisk(
  fullPath: string,
  body: Buffer,
): Promise<void> {
  try {
    const dir = path.dirname(fullPath);
    await fsp.mkdir(dir, { recursive: true });
    const tmp =
      fullPath + ".tmp." + process.pid + "." + Math.random().toString(36).slice(2, 8);
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, fullPath);
  } catch (err) {
    logger.warn(
      { err, fullPath },
      "Failed to restore Object-Storage-served attached asset to local disk",
    );
  }
}

/**
 * One-time idempotent backfill: uploads every bundled `.pdf` under
 * `attached_assets/` into Object Storage under `legacy-attached-assets/`,
 * so a republish — which gives the container a fresh filesystem —
 * still has the source PDFs to fall back to. Re-running this is
 * cheap: we list the bucket first and skip any object that already
 * exists.
 */
export interface BackfillLogger {
  info: (obj: Record<string, unknown> | string, msg?: string) => void;
  warn: (obj: Record<string, unknown> | string, msg?: string) => void;
}

export async function backfillAttachedAssetsToObjectStorage(
  log: BackfillLogger = logger as unknown as BackfillLogger,
): Promise<{ uploaded: number; skipped: number; failed: number }> {
  const bucketName = objectStorageBucketName();
  if (!bucketName) {
    log.info(
      "PRIVATE_OBJECT_DIR is not set — skipping attached-assets backfill",
    );
    return { uploaded: 0, skipped: 0, failed: 0 };
  }
  const baseDir = attachedAssetsDir();
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(baseDir);
  } catch {
    log.info({ baseDir }, "attached_assets/ does not exist — skipping backfill");
    return { uploaded: 0, skipped: 0, failed: 0 };
  }
  const pdfs = entries.filter((e) => e.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 0) return { uploaded: 0, skipped: 0, failed: 0 };

  // List already-uploaded objects once so we don't HEAD per-file.
  const prefix = objectStoragePrefix();
  let existingNames = new Set<string>();
  try {
    const [files] = await objectStorageClient
      .bucket(bucketName)
      .getFiles({ prefix });
    for (const f of files) {
      existingNames.add(f.name.slice(prefix.length));
    }
  } catch (err) {
    log.warn(
      { err },
      "Could not list Object Storage backfill prefix — will HEAD per-file",
    );
    existingNames = new Set();
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const filename of pdfs) {
    if (existingNames.has(filename)) {
      skipped += 1;
      continue;
    }
    try {
      const buf = await fsp.readFile(path.join(baseDir, filename));
      const ok = await uploadToObjectStorage(
        filename,
        buf,
        "application/pdf",
      );
      if (ok) uploaded += 1;
      else failed += 1;
    } catch (err) {
      log.warn({ err, filename }, "Backfill failed for asset");
      failed += 1;
    }
  }
  log.info(
    { uploaded, skipped, failed, total: pdfs.length },
    "Attached-assets Object Storage backfill complete",
  );
  return { uploaded, skipped, failed };
}

function attachedAssetsDir(): string {
  return path.resolve(process.cwd(), "..", "..", "attached_assets");
}

function thumbnailDir(): string {
  return path.join(attachedAssetsDir(), ".thumbnails");
}

const ALLOWED_EXTENSIONS = new Set([".pdf"]);

const SAFE_FILENAME_RE = /^[A-Za-z0-9._,\-+()#@]+$/;

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

function thumbnailCacheKey(filename: string, mtimeMs: number, width: number): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${filename}:${mtimeMs}:${width}`)
    .digest("hex")
    .slice(0, 16);
  return `${hash}.png`;
}

async function readCachedThumbnail(cacheFile: string): Promise<Buffer | null> {
  try {
    return await fsp.readFile(cacheFile);
  } catch {
    return null;
  }
}

async function writeCachedThumbnail(cacheFile: string, png: Buffer): Promise<void> {
  const dir = path.dirname(cacheFile);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = cacheFile + ".tmp." + process.pid + "." + Math.random().toString(36).slice(2, 8);
  try {
    await fsp.writeFile(tmp, png);
    await fsp.rename(tmp, cacheFile);
  } catch {
    await fsp.unlink(tmp).catch(() => {});
  }
}

let _pdfjsMod: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
let _canvasMod: typeof import("@napi-rs/canvas") | null = null;
let _protoFixed = false;

function fixEnumerableArrayPrototypeForPdfjs(): void {
  if (_protoFixed) return;
  _protoFixed = true;
  const desc = Object.getOwnPropertyDescriptor(Array.prototype, "random");
  if (desc && desc.enumerable) {
    Object.defineProperty(Array.prototype, "random", {
      ...desc,
      enumerable: false,
    });
  }
}

async function loadRenderDeps() {
  if (!_pdfjsMod || !_canvasMod) {
    fixEnumerableArrayPrototypeForPdfjs();
    const [canvas, pdfjs] = await Promise.all([
      import("@napi-rs/canvas"),
      import("pdfjs-dist/legacy/build/pdf.mjs"),
    ]);
    _canvasMod = canvas;
    _pdfjsMod = pdfjs;
  }
  return { createCanvas: _canvasMod.createCanvas, pdfjs: _pdfjsMod };
}

async function renderPdfFirstPagePng(
  pdfPath: string,
  targetWidth: number,
): Promise<Buffer | null> {
  try {
    const { createCanvas, pdfjs } = await loadRenderDeps();
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

router.get("/attached-assets/:filename/thumbnail", async (req, res): Promise<void> => {
  const raw = req.params.filename ?? "";
  const resolved = resolveAttachedAsset(raw);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  let stat: fs.Stats | null = null;
  try {
    stat = await fsp.stat(resolved.fullPath);
    if (!stat.isFile()) stat = null;
  } catch {
    stat = null;
  }
  if (!stat) {
    // Republish fallback: try Object Storage and rehydrate disk.
    const remote = await downloadFromObjectStorage(resolved.filename);
    if (!remote) {
      res.status(404).json({ error: "Source PDF not found." });
      return;
    }
    await restoreAssetToDisk(resolved.fullPath, remote);
    try {
      stat = await fsp.stat(resolved.fullPath);
    } catch {
      // Fall back to a synthetic stat from `now` so the cache key is
      // stable across this request — disk persistence may have failed
      // but rendering should still work.
      stat = { mtimeMs: Date.now() } as fs.Stats;
    }
  }

  const widthParam = Number.parseInt(String(req.query.w ?? ""), 10);
  const targetWidth = Number.isFinite(widthParam)
    ? Math.min(400, Math.max(40, widthParam))
    : 160;

  const cacheFile = path.join(
    thumbnailDir(),
    thumbnailCacheKey(resolved.filename, stat.mtimeMs, targetWidth),
  );
  const cached = await readCachedThumbnail(cacheFile);
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
  await writeCachedThumbnail(cacheFile, png);
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

  fs.stat(fullPath, async (err, stat) => {
    if (err || !stat || !stat.isFile()) {
      // Republish fallback: republished containers get a fresh
      // filesystem, so a missing local PDF may still live in Object
      // Storage from a previous boot. If we find it, restore it to
      // disk and serve.
      const remote = await downloadFromObjectStorage(filename);
      if (!remote) {
        res.status(404).json({ error: "Source PDF not found." });
        return;
      }
      await restoreAssetToDisk(fullPath, remote);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${filename}"`,
      );
      res.send(remote);
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

const DEFAULT_PREWARM_WIDTH = 120;
const PREWARM_YIELD_INTERVAL = 3;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface PrewarmLogger {
  info: (msg: string) => void;
  warn: (obj: { err?: unknown }, msg: string) => void;
}

export async function prewarmThumbnails(logger: PrewarmLogger): Promise<void> {
  const baseDir = attachedAssetsDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(baseDir);
  } catch {
    logger.warn({}, "Could not read attached_assets/ for thumbnail pre-warm — skipping");
    return;
  }

  const pdfs = entries.filter((e) => e.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 0) return;

  await fsp.mkdir(thumbnailDir(), { recursive: true });

  await loadRenderDeps();

  let rendered = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | undefined;
  let sinceYield = 0;

  for (const filename of pdfs) {
    const fullPath = path.join(baseDir, filename);
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(fullPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const cacheFile = path.join(
      thumbnailDir(),
      thumbnailCacheKey(filename, stat.mtimeMs, DEFAULT_PREWARM_WIDTH),
    );
    const existing = await readCachedThumbnail(cacheFile);
    if (existing) {
      skipped++;
      continue;
    }
    const png = await renderPdfFirstPagePng(fullPath, DEFAULT_PREWARM_WIDTH);
    if (png) {
      await writeCachedThumbnail(cacheFile, png);
      rendered++;
    } else {
      failed++;
      if (!firstError) firstError = filename;
    }
    sinceYield++;
    if (sinceYield >= PREWARM_YIELD_INTERVAL) {
      sinceYield = 0;
      await yieldToEventLoop();
    }
  }

  const summary = `Thumbnail pre-warm complete: ${rendered} rendered, ${skipped} already cached, ${failed} failed (${pdfs.length} PDFs total)`;
  if (firstError && failed > 0) {
    logger.warn({ err: firstError }, summary);
  } else {
    logger.info(summary);
  }
}

export default router;
