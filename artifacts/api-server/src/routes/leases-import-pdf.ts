import { Router, type IRouter } from "express";
import multer from "multer";
import { db, customersTable, propertiesTable } from "@workspace/db";
import {
  extractLeaseFromText,
  rankPropertyCandidates,
} from "../lib/lease-pdf-import";
import { logger } from "../lib/logger";

// pdf-parse v2 exposes a `PDFParse` class (no default function any more).
// We feed it the in-memory upload buffer and ask only for text.
import { PDFParse } from "pdf-parse";

const router: IRouter = Router();

// Hold the PDF in RAM — we never write it to disk and never store it.
// Cap at 10 MB so a runaway upload can't OOM the server.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

router.post(
  "/leases/import-pdf",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing 'file' field in multipart upload." });
      return;
    }

    const lcType = (file.mimetype ?? "").toLowerCase();
    const lcName = (file.originalname ?? "").toLowerCase();
    if (lcType !== "application/pdf" && !lcName.endsWith(".pdf")) {
      res.status(400).json({
        error: `Only PDF uploads are supported (got mimetype "${file.mimetype}").`,
      });
      return;
    }

    let text: string;
    try {
      // PDFParse needs a Uint8Array (it transfers ownership to the worker),
      // so hand it a fresh copy of the upload buffer rather than the Node
      // Buffer view shared with multer.
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      const parsed = await parser.getText();
      text = (parsed.text ?? "").trim();
      await parser.destroy?.();
    } catch (err) {
      logger.warn({ err }, "pdf-parse failed");
      res.status(400).json({
        error:
          "Couldn't read this PDF. It may be image-only (scanned) — OCR isn't supported here.",
      });
      return;
    }

    if (text.length < 50) {
      // pdf-parse returns text even for image-only PDFs, but it's almost
      // empty. Treat that the same as an unreadable file rather than
      // silently asking the LLM to hallucinate from nothing.
      res.status(400).json({
        error:
          "This PDF doesn't contain readable text — it may be a scanned image. OCR isn't supported.",
      });
      return;
    }

    let extracted;
    try {
      extracted = await extractLeaseFromText(text);
    } catch (err) {
      logger.error({ err }, "Lease LLM extraction failed");
      res.status(502).json({
        error: "Couldn't extract lease fields from this PDF. Please try again.",
      });
      return;
    }

    const [properties, customers] = await Promise.all([
      db.select().from(propertiesTable),
      db.select().from(customersTable),
    ]);

    const candidates = rankPropertyCandidates(extracted, properties, customers);
    // Treat the top candidate as a "match" only when it's clearly above
    // the noise floor — otherwise the dialog defaults to "create new".
    const topMatch = candidates[0] && candidates[0].score >= 0.6 ? candidates[0] : null;

    res.json({
      extracted,
      topMatch,
      candidates,
    });
  },
);

export default router;
