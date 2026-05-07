import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startMasterFileWatcher, type MasterFileSnapshot } from "./master-file-watcher";

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function snap(filePath: string, mtimeMs: number): MasterFileSnapshot {
  return { filePath, mtimeMs };
}

describe("startMasterFileWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls reimport when the master file mtime changes", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockResolvedValue(undefined);
    const resolver = vi.fn().mockResolvedValue(snap("/fake/master_001.xlsx", 1000));

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);

    resolver.mockResolvedValue(snap("/fake/master_001.xlsx", 2000));
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "/fake/master_001.xlsx" }),
      expect.stringContaining("change detected"),
    );

    stop();
  });

  it("does not call reimport when mtime is unchanged", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockResolvedValue(undefined);
    const resolver = vi.fn().mockResolvedValue(snap("/fake/master_001.xlsx", 1000));

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).not.toHaveBeenCalled();

    stop();
  });

  it("handles missing file gracefully", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockResolvedValue(undefined);
    const resolver = vi.fn().mockResolvedValue(null);

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).not.toHaveBeenCalled();

    stop();
  });

  it("triggers reimport when a file appears after being absent at startup", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockResolvedValue(undefined);
    const resolver = vi.fn().mockResolvedValue(null);

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);

    resolver.mockResolvedValue(snap("/fake/master_002.xlsx", 3000));
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).toHaveBeenCalledTimes(1);

    stop();
  });

  it("triggers reimport when a new master file with a different path appears", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockResolvedValue(undefined);
    const resolver = vi.fn().mockResolvedValue(snap("/fake/master_001.xlsx", 1000));

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);

    resolver.mockResolvedValue(snap("/fake/master_002.xlsx", 5000));
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).toHaveBeenCalledTimes(1);

    stop();
  });

  it("logs error when reimport fails and retries on next poll", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockRejectedValue(new Error("DB down"));
    const resolver = vi.fn().mockResolvedValue(snap("/fake/master_001.xlsx", 1000));

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);

    resolver.mockResolvedValue(snap("/fake/master_001.xlsx", 2000));
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringContaining("re-import failed"),
    );

    reimport.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(60);

    expect(reimport).toHaveBeenCalledTimes(2);

    stop();
  });

  it("stop prevents further polling", async () => {
    const logger = fakeLogger();
    const reimport = vi.fn().mockResolvedValue(undefined);
    const resolver = vi.fn().mockResolvedValue(snap("/fake/master_001.xlsx", 1000));

    const stop = startMasterFileWatcher({
      reimport,
      logger,
      pollIntervalMs: 50,
      resolveLatestSnapshot: resolver,
    });

    await vi.advanceTimersByTimeAsync(10);
    stop();

    resolver.mockResolvedValue(snap("/fake/master_001.xlsx", 2000));
    await vi.advanceTimersByTimeAsync(200);

    expect(reimport).not.toHaveBeenCalled();
  });
});
