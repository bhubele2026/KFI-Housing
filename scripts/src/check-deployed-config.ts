// Post-deploy smoke check for the Google Maps key plumbing.
//
// Why this script exists
// ----------------------
// The api-server's `GET /api/config` is the single source of truth the
// housingops web app reads on mount for the Google Maps API key
// (property-detail Location card + portfolio map). The route accepts
// either `GOOGLE_MAPS_API_KEY` (canonical) or `VITE_GOOGLE_MAPS_API_KEY`
// (legacy fallback) — see `artifacts/api-server/src/routes/config.ts`.
//
// Tasks #143 / #147 / #154 / #187 each closed one loop on the
// silent-failure mode where the secret is set under one name while the
// code reads the other. The remaining hole is the *deploy*: the build
// can succeed, the api-server can boot, and yet the env var never makes
// it to the live process — at which point `/api/config` returns
// `{"googleMapsApiKey": null, ...}` and the only person who notices is
// the operator who happens to open the property page after deploy and
// sees the dashed "API key isn't configured" fallback.
//
// IMPORTANT: this script is NOT automatically wired into any deploy
// hook in this repo. The authoritative automatic guard for Task #191
// is the production fast-fail in `artifacts/api-server/src/start.ts`
// (exits 1 before `listen()` when neither env var is set), which
// combines with the autoscale startup health probe at `/api/healthz`
// to keep a bad revision from being promoted. This smoke check is a
// *manual / opt-in* operator tool: invoke it against an already-live
// deploy URL when you want a separate end-to-end verification that
// `/api/config` is actually serving a non-null `googleMapsApiKey`
// (e.g. when chasing down a UI report of a dashed map). It exits
// non-zero with a message that names both env vars if the key is
// missing.
//
// Local dev is intentionally unaffected: the api-server already emits a
// startup WARN naming both env vars (Task #187, see
// `artifacts/api-server/src/start.ts: warnIfGoogleMapsKeyMissing`), and
// this script is opt-in — nothing in `scripts/post-merge.sh` or any
// dev workflow invokes it.

export interface CheckDeployedConfigOptions {
  /**
   * Base URL of the deployed api-server (e.g. `https://kfi.replit.app`).
   * `/api/config` is appended automatically. A trailing slash is fine.
   */
  baseUrl: string;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Per-attempt request timeout. Defaults to 10s. The deployed
   * api-server's `/api/config` route does no I/O, so anything slower
   * than this is almost certainly a network/DNS problem worth surfacing.
   */
  timeoutMs?: number;
}

export interface CheckDeployedConfigSuccess {
  ok: true;
  url: string;
}

export interface CheckDeployedConfigFailure {
  ok: false;
  url: string;
  /**
   * Operator-facing message that always names both
   * `GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_MAPS_API_KEY` so whoever
   * reads the CI failure knows exactly which two secrets to check
   * without having to dig through the route source.
   */
  message: string;
}

export type CheckDeployedConfigResult =
  | CheckDeployedConfigSuccess
  | CheckDeployedConfigFailure;

const CONFIG_PATH = "/api/config";

const FAILURE_HINT =
  "Set GOOGLE_MAPS_API_KEY (canonical) — or the legacy " +
  "VITE_GOOGLE_MAPS_API_KEY fallback — on the deployed api-server " +
  "and redeploy. Both names are accepted by GET /api/config; if " +
  "this check is failing the deployed process has neither set to a " +
  "non-empty value.";

function joinConfigUrl(baseUrl: string): string {
  // Trim a single trailing slash so `https://foo/` and `https://foo`
  // both produce `https://foo/api/config` rather than `//api/config`.
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}${CONFIG_PATH}`;
}

export async function checkDeployedConfig(
  options: CheckDeployedConfigOptions,
): Promise<CheckDeployedConfigResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const url = joinConfigUrl(options.baseUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      url,
      message:
        `Could not reach ${url} (${describeError(err)}). ` + FAILURE_HINT,
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return {
      ok: false,
      url,
      message:
        `${url} returned HTTP ${response.status} ${response.statusText}. ` +
        FAILURE_HINT,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      url,
      message:
        `${url} returned a non-JSON body (${describeError(err)}). ` +
        FAILURE_HINT,
    };
  }

  if (!isPlainObject(body) || !("googleMapsApiKey" in body)) {
    return {
      ok: false,
      url,
      message:
        `${url} response is missing the googleMapsApiKey field — ` +
        `got ${shortJson(body)}. ` +
        FAILURE_HINT,
    };
  }

  const raw = body.googleMapsApiKey;
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      url,
      message:
        `${url} returned googleMapsApiKey=${shortJson(raw)} — the ` +
        `deployed api-server has neither GOOGLE_MAPS_API_KEY nor the ` +
        `legacy VITE_GOOGLE_MAPS_API_KEY set to a non-empty value, ` +
        `so the property-detail Location card and the portfolio map ` +
        `will render their "API key isn't configured" fallback. ` +
        FAILURE_HINT,
    };
  }

  return { ok: true, url };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    if (s === undefined) return String(value);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  } catch {
    return String(value);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "AbortError"
      ? "request timed out"
      : `${err.name}: ${err.message}`;
  }
  return String(err);
}

// CLI entry point. Picks up the deploy URL from (in order):
//   1. The first positional CLI arg
//   2. The `DEPLOY_URL` env var
// Exits 0 on success, 1 on any failure. The failure message is printed
// to stderr so it surfaces in CI logs even if stdout is being captured.
export function resolveBaseUrl(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string | null {
  const arg = argv.find((a) => !a.startsWith("-"));
  if (arg && arg.trim() !== "") return arg.trim();
  const fromEnv = (env["DEPLOY_URL"] ?? "").trim();
  if (fromEnv !== "") return fromEnv;
  return null;
}

export async function runCli(deps: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const baseUrl = resolveBaseUrl(deps.argv, deps.env);
  if (!baseUrl) {
    deps.stderr(
      "check-deployed-config: missing deploy URL. Pass it as the " +
        "first CLI arg (e.g. `pnpm --filter @workspace/scripts run " +
        "check:deployed-config https://your-app.replit.app`) or set " +
        "the DEPLOY_URL env var.",
    );
    return 1;
  }

  const result = await checkDeployedConfig({
    baseUrl,
    fetchImpl: deps.fetchImpl,
  });

  if (result.ok) {
    deps.stdout(
      `check-deployed-config: ${result.url} returned a non-empty ` +
        `googleMapsApiKey. OK.`,
    );
    return 0;
  }

  deps.stderr(`check-deployed-config: ${result.message}`);
  return 1;
}

// Only run the CLI when invoked directly (e.g. via `tsx`/`node`),
// not when imported by the test file.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /check-deployed-config(\.[cm]?[jt]s)?$/.test(process.argv[1]);

if (invokedDirectly) {
  runCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  })
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(
        `check-deployed-config: unexpected error: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );
      process.exit(1);
    });
}
