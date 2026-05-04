// Manual / opt-in env-presence precheck for the Google Maps key.
//
// IMPORTANT: this script is NOT automatically wired into any deploy
// hook in this repo. The authoritative automatic guard for Task #191
// is the production fast-fail in `artifacts/api-server/src/start.ts`,
// which exits 1 before `listen()` if neither GOOGLE_MAPS_API_KEY nor
// VITE_GOOGLE_MAPS_API_KEY is set; combined with the autoscale
// startup health probe at `/api/healthz`, that prevents a bad
// revision from being promoted. This script exists as a *manual*
// pre-publish guard an operator can run locally (or pipe into a
// future CI job) to fail loudly before they click Publish, instead
// of waiting for the deploy itself to fail its health check.
//
// Why this exists alongside `check-deployed-config.ts`
// ----------------------------------------------------
// `check-deployed-config.ts` hits `<deploy-url>/api/config` against a
// live process — useful after a deploy. This script validates the
// same condition the route validates (canonical name OR legacy
// fallback set to a non-empty trimmed string), but against
// `process.env` directly, so it works *before* a deploy URL exists.
//
// Local dev is unaffected: this script is opt-in and not invoked
// from `scripts/post-merge.sh` or any dev workflow. The dev-side
// WARN at `artifacts/api-server/src/start.ts:
// warnIfGoogleMapsKeyMissing` continues to cover dev.

const PRIMARY = "GOOGLE_MAPS_API_KEY";
const LEGACY = "VITE_GOOGLE_MAPS_API_KEY";

const FAILURE_HINT =
  `Set ${PRIMARY} (canonical) — or the legacy ${LEGACY} fallback — ` +
  `as a deploy secret on this Replit and re-publish. The api-server's ` +
  `GET /api/config route accepts either name; if this precheck is ` +
  `failing then neither is set to a non-empty value in the deploy ` +
  `environment, so the deploy would land in production with the ` +
  `dashed "API key isn't configured" map fallback.`;

export interface CheckDeployEnvOptions {
  env: NodeJS.ProcessEnv;
}

export interface CheckDeployEnvSuccess {
  ok: true;
  /** Which env var name supplied the value — useful in the success log. */
  source: typeof PRIMARY | typeof LEGACY;
}

export interface CheckDeployEnvFailure {
  ok: false;
  message: string;
}

export type CheckDeployEnvResult =
  | CheckDeployEnvSuccess
  | CheckDeployEnvFailure;

export function checkDeployEnv(
  options: CheckDeployEnvOptions,
): CheckDeployEnvResult {
  // Mirror exactly what `artifacts/api-server/src/routes/config.ts`
  // does: trim, treat empty/whitespace as unset, prefer canonical
  // over legacy. Keeping the logic identical means a deploy that
  // passes this precheck is guaranteed to make `/api/config` return
  // a non-empty `googleMapsApiKey` at runtime — there is no way for
  // the two sides to drift apart.
  const trim = (raw: string | undefined): string | null => {
    const v = (raw ?? "").trim();
    return v === "" ? null : v;
  };
  const primary = trim(options.env[PRIMARY]);
  if (primary !== null) return { ok: true, source: PRIMARY };
  const legacy = trim(options.env[LEGACY]);
  if (legacy !== null) return { ok: true, source: LEGACY };
  return {
    ok: false,
    message:
      `Neither ${PRIMARY} nor ${LEGACY} is set (or both are empty / ` +
      `whitespace-only) in the deploy build environment. ` +
      FAILURE_HINT,
  };
}

export interface RunCliDeps {
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export function runCli(deps: RunCliDeps): number {
  const result = checkDeployEnv({ env: deps.env });
  if (result.ok) {
    deps.stdout(
      `check-deploy-env: ${result.source} is set in the deploy ` +
        `environment — runtime /api/config will return a non-empty ` +
        `googleMapsApiKey. OK.`,
    );
    return 0;
  }
  deps.stderr(`check-deploy-env: ${result.message}`);
  return 1;
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /check-deploy-env(\.[cm]?[jt]s)?$/.test(process.argv[1]);

if (invokedDirectly) {
  const code = runCli({
    env: process.env,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });
  process.exit(code);
}
