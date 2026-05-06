import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer, { MulterError } from "multer";
import {
  importMasterLeases,
  importDefaultMasterLeases,
  readMasterWorkbookFromBuffer,
} from "../lib/import-master-leases";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_XLSX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XLSX_BYTES, files: 1 },
});

function uploadOptionalXlsx(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `Workbook is too large. Maximum size is ${Math.round(
            MAX_XLSX_BYTES / (1024 * 1024),
          )} MB.`,
        });
        return;
      }
      res.status(400).json({ error: `Upload rejected: ${err.message}` });
      return;
    }
    next(err);
  });
}

router.post(
  "/leases/import-master",
  uploadOptionalXlsx,
  async (req, res): Promise<void> => {
    try {
      const file = req.file;
      let summary;
      if (file) {
        if (
          file.mimetype &&
          !file.mimetype.includes("spreadsheet") &&
          !file.mimetype.includes("excel") &&
          file.mimetype !== "application/octet-stream"
        ) {
          res
            .status(415)
            .json({ error: `Expected an .xlsx workbook, got ${file.mimetype}.` });
          return;
        }
        const rows = readMasterWorkbookFromBuffer(file.buffer);
        summary = await importMasterLeases(rows, { logger });
      } else {
        summary = await importDefaultMasterLeases({ logger });
      }
      res.json(summary);
    } catch (err) {
      logger.error({ err }, "Master lease import failed");
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  },
);

export default router;
