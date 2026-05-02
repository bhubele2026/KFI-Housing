import { describe, it, expect, beforeEach } from "vitest";
import {
  recordLeaseUpload,
  clearLeaseUpload,
  __resetRecentLeaseUploadsForTests,
  __getRecentLeaseUploadsForTests,
  type RecentLeaseUpload,
} from "./recent-lease-uploads";

function makeUpload(partial: Partial<RecentLeaseUpload> & { id: string }): RecentLeaseUpload {
  return {
    id: partial.id,
    fileName: partial.fileName ?? `${partial.id}.pdf`,
    status: partial.status ?? "parsed",
    errorMessage: partial.errorMessage,
    file: partial.file,
    timestamp: partial.timestamp ?? Date.now(),
  };
}

describe("recent-lease-uploads store", () => {
  beforeEach(() => {
    __resetRecentLeaseUploadsForTests();
  });

  it("records newest entries at the front", () => {
    recordLeaseUpload(makeUpload({ id: "a", fileName: "first.pdf" }));
    recordLeaseUpload(makeUpload({ id: "b", fileName: "second.pdf" }));
    expect(__getRecentLeaseUploadsForTests().map((u) => u.id)).toEqual(["b", "a"]);
  });

  it("caps the list at 5 entries, dropping the oldest", () => {
    for (let i = 0; i < 7; i++) {
      recordLeaseUpload(makeUpload({ id: `u${i}` }));
    }
    const snapshot = __getRecentLeaseUploadsForTests();
    expect(snapshot).toHaveLength(5);
    expect(snapshot.map((u) => u.id)).toEqual(["u6", "u5", "u4", "u3", "u2"]);
  });

  it("clearLeaseUpload removes the matching entry", () => {
    recordLeaseUpload(makeUpload({ id: "keep" }));
    recordLeaseUpload(makeUpload({ id: "drop" }));
    clearLeaseUpload("drop");
    expect(__getRecentLeaseUploadsForTests().map((u) => u.id)).toEqual(["keep"]);
  });

  it("clearLeaseUpload on an unknown id is a no-op", () => {
    recordLeaseUpload(makeUpload({ id: "only" }));
    const before = __getRecentLeaseUploadsForTests();
    clearLeaseUpload("does-not-exist");
    expect(__getRecentLeaseUploadsForTests()).toBe(before);
    expect(__getRecentLeaseUploadsForTests().map((u) => u.id)).toEqual(["only"]);
  });

  it("preserves the File object and error message on failed uploads", () => {
    const file = new File(["dummy"], "lease.pdf", { type: "application/pdf" });
    recordLeaseUpload(
      makeUpload({ id: "f1", status: "failed", file, errorMessage: "boom" }),
    );
    const top = __getRecentLeaseUploadsForTests()[0];
    expect(top.file).toBe(file);
    expect(top.errorMessage).toBe("boom");
    expect(top.status).toBe("failed");
  });
});
