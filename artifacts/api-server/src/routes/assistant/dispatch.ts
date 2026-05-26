/**
 * Internal route dispatcher used by the assistant write tools so that
 * their `execute()` flows through the EXACT same validation chain a
 * human operator's HTTP request would hit (Task #646). Before this
 * helper, each assistant write tool called `db.insert/update` directly
 * and bypassed the validation logic the Express route handlers had
 * grown over the past year — Zod request schemas, the
 * `db-row-normalizers` boundary coercion, the cleaning-workflow guard
 * on bed/occupant moves (#500), the lead-tenant single-lead-per-room
 * invariant (#500), lease status derivation, address geocoding, etc.
 * Routing through the in-process Express app means every one of those
 * gates fires for assistant-initiated writes too.
 *
 * Implementation: a tiny standalone Express `Express` instance that
 * mounts the data routers (NO auth middleware — the assistant runtime
 * has already authorised the caller and gated the proposal behind a
 * user-confirmed approval card). Each `callRoute(...)` invocation
 * synthesises a minimal req/res pair and lets express's normal
 * routing+param-parsing run against it, then resolves with the status
 * and JSON body the handler emitted.
 */

import express, { type Express } from "express";
import propertiesRouter from "../properties";
import buildingsRouter from "../buildings";
import roomsRouter from "../rooms";
import bedsRouter from "../beds";
import occupantsRouter from "../occupants";
import leasesRouter from "../leases";
import utilitiesRouter from "../utilities";
import insuranceCertificatesRouter from "../insurance-certificates";
import customersRouter from "../customers";

const internalApp: Express = express();
// No body-parser is mounted — `callRoute` pre-populates `req.body`
// directly, so there are no raw bytes to parse. Skipping the
// middleware avoids accidentally running JSON.parse on data the
// caller has already shaped, and keeps this dispatcher independent of
// the public app's body-parser config.
internalApp.use(propertiesRouter);
internalApp.use(buildingsRouter);
internalApp.use(roomsRouter);
internalApp.use(bedsRouter);
internalApp.use(occupantsRouter);
internalApp.use(leasesRouter);
internalApp.use(utilitiesRouter);
internalApp.use(insuranceCertificatesRouter);
internalApp.use(customersRouter);

export type DispatchMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface DispatchResult {
  status: number;
  body: unknown;
}

/**
 * Dispatch a request through the in-process router stack. Always
 * resolves — non-2xx responses are returned as `{ status, body }` so
 * the caller can decide how to surface them (the wrapper
 * `callRouteOrThrow` is the usual choice).
 */
export function callRoute(
  method: DispatchMethod,
  path: string,
  body?: unknown,
): Promise<DispatchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let status = 200;
    let respBody: unknown = undefined;
    const headers: Record<string, unknown> = {};

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve({ status, body: respBody });
    };

    const reqHeaders: Record<string, string> = {
      "content-type": "application/json",
      host: "internal",
    };
    const req = {
      method,
      url: path,
      originalUrl: path,
      path,
      baseUrl: "",
      headers: reqHeaders,
      body: body ?? {},
      params: {},
      query: {},
      get(name: string): unknown {
        return reqHeaders[name.toLowerCase()];
      },
      header(name: string): unknown {
        return reqHeaders[name.toLowerCase()];
      },
      on(): void {},
      once(): void {},
      removeListener(): void {},
      off(): void {},
    } as unknown as express.Request;

    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader(name: string, value: unknown): unknown {
        headers[name.toLowerCase()] = value;
        return this;
      },
      getHeader(name: string): unknown {
        return headers[name.toLowerCase()];
      },
      removeHeader(name: string): void {
        delete headers[name.toLowerCase()];
      },
      status(n: number): unknown {
        status = n;
        (this as { statusCode: number }).statusCode = n;
        return this;
      },
      json(b: unknown): unknown {
        respBody = b;
        finish();
        return this;
      },
      send(b: unknown): unknown {
        respBody = b;
        finish();
        return this;
      },
      sendStatus(n: number): unknown {
        status = n;
        (this as { statusCode: number }).statusCode = n;
        respBody = undefined;
        finish();
        return this;
      },
      end(b?: unknown): unknown {
        if (b !== undefined) respBody = b;
        finish();
        return this;
      },
      write(): boolean {
        return true;
      },
      flushHeaders(): void {},
      on(): void {},
      once(): void {},
      removeListener(): void {},
      off(): void {},
    } as unknown as express.Response;

    try {
      internalApp(req, res, (err?: unknown) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        if (!settled) {
          // No handler claimed the request — surface as a 404 so the
          // caller's normal error path runs.
          status = 404;
          respBody = { error: `No route for ${method} ${path}` };
          finish();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Convenience wrapper that throws on non-2xx so write tools can write
 * a straight `await callRouteOrThrow(...)` and let the assistant
 * runtime convert the thrown error into a `tool_result` with
 * `is_error: true`. Carries the route's `error` message through verbatim
 * so the model can explain it to the operator.
 */
export async function callRouteOrThrow<T = unknown>(
  method: DispatchMethod,
  path: string,
  body?: unknown,
): Promise<T> {
  const { status, body: resBody } = await callRoute(method, path, body);
  if (status >= 400) {
    const msg =
      (resBody && typeof resBody === "object" && "error" in resBody
        ? String((resBody as { error: unknown }).error)
        : null) ??
      (typeof resBody === "string" ? resBody : null) ??
      `HTTP ${status}`;
    throw new Error(msg);
  }
  return resBody as T;
}
