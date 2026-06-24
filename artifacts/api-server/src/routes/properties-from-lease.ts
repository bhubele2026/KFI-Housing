import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import { extractLeaseFromPdfBuffer } from "../lib/lease-pdf-import";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1 } });

function uploadSinglePdf(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "PDF too large (max 10 MB)." });
      return;
    }
    res.status(400).json({ error: "Upload failed." });
  });
}

// ---------------------------------------------------------------------------
// Overhaul §7 — "Add a property — drop a lease". Parses the PDF with the
// existing AI lease parser and returns a DRAFT for operator review. Creates
// NOTHING (the frontend confirms via the existing property/rooms/beds/lease
// create routes once the operator approves). Direct-fetch, multipart.
// ---------------------------------------------------------------------------
router.post("/properties/from-lease", uploadSinglePdf, async (req: Request, res: Response): Promise<void> => {
  try {
    const file = (req as Request & { file?: { buffer?: Buffer } }).file;
    if (!file?.buffer) {
      res.status(400).json({ error: "No PDF uploaded (field name must be 'file')." });
      return;
    }
    const { extracted } = await extractLeaseFromPdfBuffer(file.buffer);
    // Flag the fields the parser couldn't fill so the reviewer fixes them
    // before saving (never fabricate — null ⇒ needsReview).
    const needsReview: string[] = [];
    for (const k of ["propertyName", "propertyAddress", "monthlyRent", "startDate"] as const) {
      if (extracted[k] == null) needsReview.push(k);
    }
    res.json({ draft: extracted, needsReview, confidence: extracted.confidence });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "properties/from-lease parse failed");
    res.status(502).json({ error: "Couldn't read this lease PDF — try a clearer scan or enter the property manually." });
  }
});

export default router;
