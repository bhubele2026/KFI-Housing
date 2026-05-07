import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";

import attachedAssetsRouter from "./attached-assets";

// The route resolves `attached_assets/` as `path.resolve(process.cwd(),
// "..", "..", "attached_assets")` — the api-server runs from
// `artifacts/api-server/` so the bundled assets sit two levels up. To keep
// the tests cwd-agnostic (vitest may launch from the repo root or the
// package), point cwd at the api-server package for the duration of the
// suite. We snapshot and restore the original cwd in afterAll.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "artifacts", "api-server");

describe("GET /api/attached-assets/:filename", () => {
  let server: http.Server;
  let baseUrl: string;
  const originalCwd = process.cwd();
  // A real PDF that ships in the repo — we don't generate fixtures because
  // the contract IS that bundled lease PDFs are reachable from the route.
  const REAL_PDF = "Chateau_Knoll_Lease_-_1407_1778107759430.pdf";

  beforeAll(async () => {
    process.chdir(PACKAGE_DIR);

    // Sanity check that the fixture PDF actually exists; otherwise a future
    // asset rename would silently turn the success-path test into a
    // false negative.
    const fixturePath = path.join(
      REPO_ROOT,
      "attached_assets",
      REAL_PDF,
    );
    if (!fs.existsSync(fixturePath)) {
      throw new Error(
        `Test fixture missing — expected ${REAL_PDF} under attached_assets/`,
      );
    }

    const app: Express = express();
    app.use("/api", attachedAssetsRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    process.chdir(originalCwd);
  });

  it("serves a bundled lease PDF as application/pdf", async () => {
    const res = await fetch(`${baseUrl}/api/attached-assets/${REAL_PDF}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/pdf/);
    // Content-Disposition: inline so the browser opens the PDF in a new
    // tab instead of downloading; the filename hint preserves the
    // original name for save-as.
    const disp = res.headers.get("content-disposition") ?? "";
    expect(disp).toContain("inline");
    expect(disp).toContain(REAL_PDF);
    // The body should start with the PDF magic bytes.
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("returns 404 when the file does not exist", async () => {
    const res = await fetch(
      `${baseUrl}/api/attached-assets/Definitely_Not_A_Real_File_xyz.pdf`,
    );
    expect(res.status).toBe(404);
  });

  it("rejects path traversal attempts (..) with 400", async () => {
    // The Express router normalises `..` segments before our handler runs,
    // so a literal `../` path would 404 at the router level. Hit the
    // handler directly with an encoded payload that survives the router
    // and would be dangerous if our regex ever loosened.
    const res = await fetch(
      `${baseUrl}/api/attached-assets/${encodeURIComponent("../package.json")}`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-PDF extensions with 400 (xlsx exports etc. must not leak through)", async () => {
    const res = await fetch(
      `${baseUrl}/api/attached-assets/Housing_Lease_MASTER_1778105244042.xlsx`,
    );
    expect(res.status).toBe(400);
  });

  it("rejects filenames with disallowed characters (e.g. spaces) with 400", async () => {
    const res = await fetch(
      `${baseUrl}/api/attached-assets/${encodeURIComponent("has spaces.pdf")}`,
    );
    expect(res.status).toBe(400);
  });

  // Page-1 thumbnail endpoint added in Task #344. Renders server-side via
  // pdfjs-dist + @napi-rs/canvas so the leases-table can show a visual
  // marker next to each row with a recorded source PDF.
  describe("GET /api/attached-assets/:filename/thumbnail", () => {
    it("renders a PNG thumbnail of page 1 for a real lease PDF", async () => {
      const res = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const buf = Buffer.from(await res.arrayBuffer());
      // PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) — the only contract the
      // client's <img> needs is "this is decodable as PNG".
      expect(buf[0]).toBe(0x89);
      expect(buf.slice(1, 4).toString("ascii")).toBe("PNG");
      // A page-1 thumbnail at the default ~160px width should comfortably
      // exceed a few KB (a blank page would still be hundreds of bytes,
      // but a real lease's first page contains text and layout).
      expect(buf.length).toBeGreaterThan(2000);
    });

    it("serves the cached buffer on a second request and reports it via X-Thumbnail-Cache", async () => {
      // First call may MISS or HIT depending on suite ordering; the second
      // call must HIT because the cache key is filename + mtime + width.
      await fetch(`${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail`);
      const res = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-thumbnail-cache")).toBe("HIT");
    });

    it("returns 404 when the underlying PDF does not exist", async () => {
      const res = await fetch(
        `${baseUrl}/api/attached-assets/Definitely_Not_A_Real_File_xyz.pdf/thumbnail`,
      );
      expect(res.status).toBe(404);
    });

    it("rejects path traversal attempts (..) with 400", async () => {
      const res = await fetch(
        `${baseUrl}/api/attached-assets/${encodeURIComponent("../package.json")}/thumbnail`,
      );
      expect(res.status).toBe(400);
    });

    it("rejects non-PDF extensions with 400", async () => {
      const res = await fetch(
        `${baseUrl}/api/attached-assets/Housing_Lease_MASTER_1778105244042.xlsx/thumbnail`,
      );
      expect(res.status).toBe(400);
    });

    it("clamps the requested width to the supported range", async () => {
      const res = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail?w=5000`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("persists the rendered thumbnail to disk under .thumbnails/", async () => {
      await fetch(`${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail`);
      const thumbDir = path.join(REPO_ROOT, "attached_assets", ".thumbnails");
      const files = fs.existsSync(thumbDir) ? fs.readdirSync(thumbDir) : [];
      const pngs = files.filter((f) => f.endsWith(".png"));
      expect(pngs.length).toBeGreaterThan(0);
    });

    it("serves from disk cache after first render (X-Thumbnail-Cache: HIT)", async () => {
      const first = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail`,
      );
      expect(first.status).toBe(200);
      const second = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail`,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get("x-thumbnail-cache")).toBe("HIT");
    });

    it("serves the leases-table default width (120px) from disk cache on repeat", async () => {
      const first = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail?w=120`,
      );
      expect(first.status).toBe(200);
      const second = await fetch(
        `${baseUrl}/api/attached-assets/${REAL_PDF}/thumbnail?w=120`,
      );
      expect(second.status).toBe(200);
      expect(second.headers.get("x-thumbnail-cache")).toBe("HIT");
    });
  });
});
