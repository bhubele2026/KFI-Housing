import { describe, expect, it } from "vitest";

import { checkDeployEnv, runCli } from "./check-deploy-env";

describe("checkDeployEnv", () => {
  it("succeeds when GOOGLE_MAPS_API_KEY is set", () => {
    const result = checkDeployEnv({
      env: { GOOGLE_MAPS_API_KEY: "live-key" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("GOOGLE_MAPS_API_KEY");
  });

  it("succeeds when only the legacy VITE_GOOGLE_MAPS_API_KEY is set", () => {
    // Mirrors the runtime route's fallback so an operator who is
    // still pinned to the legacy secret name (Tasks #143/#147 era)
    // doesn't get a false-positive failure here.
    const result = checkDeployEnv({
      env: { VITE_GOOGLE_MAPS_API_KEY: "legacy-key" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("VITE_GOOGLE_MAPS_API_KEY");
  });

  it("prefers GOOGLE_MAPS_API_KEY over the legacy name when both are set", () => {
    // Same precedence as the runtime route. If they ever diverge,
    // a failing test here is the loudest possible signal.
    const result = checkDeployEnv({
      env: {
        GOOGLE_MAPS_API_KEY: "canonical",
        VITE_GOOGLE_MAPS_API_KEY: "legacy",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("GOOGLE_MAPS_API_KEY");
  });

  it("falls back to the legacy var when the canonical var is whitespace-only", () => {
    const result = checkDeployEnv({
      env: {
        GOOGLE_MAPS_API_KEY: "   ",
        VITE_GOOGLE_MAPS_API_KEY: "legacy",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("VITE_GOOGLE_MAPS_API_KEY");
  });

  it("fails when neither env var is set, naming BOTH var names in the message", () => {
    const result = checkDeployEnv({ env: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });

  it("fails when both env vars are present but empty / whitespace-only", () => {
    const result = checkDeployEnv({
      env: { GOOGLE_MAPS_API_KEY: "", VITE_GOOGLE_MAPS_API_KEY: "  " },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("GOOGLE_MAPS_API_KEY");
      expect(result.message).toContain("VITE_GOOGLE_MAPS_API_KEY");
    }
  });
});

describe("runCli", () => {
  it("returns 0 and writes an OK line to stdout on success", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = runCli({
      env: { GOOGLE_MAPS_API_KEY: "k" },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("OK");
    expect(stdout.join("\n")).toContain("GOOGLE_MAPS_API_KEY");
  });

  it("returns 1 and writes the failure (with both env var names) to stderr when neither is set", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = runCli({
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    const combined = stderr.join("\n");
    expect(combined).toContain("GOOGLE_MAPS_API_KEY");
    expect(combined).toContain("VITE_GOOGLE_MAPS_API_KEY");
  });
});
