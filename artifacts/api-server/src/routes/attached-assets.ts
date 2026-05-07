import { Router, type IRouter } from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";

const router: IRouter = Router();

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
