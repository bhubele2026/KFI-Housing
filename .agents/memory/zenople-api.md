---
name: Zenople Client API integration
description: How HousingOps talks to the KFI Staffing Zenople data API — auth flow, request shape, and non-obvious quirks not visible in code.
---

# Zenople Client API

KFI Staffing's tenant exposes the Zenople Client API (read-only data retrieval, 34 actions). No Replit integration exists; credentials live in secrets.

- Auth: OAuth2 **client_credentials**. POST form-urlencoded to `${BASE}/connect/token` → bearer token, `expires_in` 7200s (2h). Cache and reuse the token.
- Data: POST JSON to `${BASE}/api/common/data` with `{ action, filters: { uTCStartDateTime, uTCEndDateTime, includeData } }`. Date format `YYYY-MM-DD HH:mm:ss.fffffff` (UTC). `includeData` = Current | All | Deleted. `TaskData`/`CommentData` also take `filters.entityList` (e.g. "All").
- Config (env): `ZENOPLE_BASE_URL` (https://kfistaffingapi.zenople.com), `ZENOPLE_TOKEN_PATH`, `ZENOPLE_DATA_PATH`. Secrets: `ZENOPLE_CLIENT_ID`, `ZENOPLE_CLIENT_SECRET`.

**Quirks (not derivable from code):**
- Some actions reject too-wide windows with HTTP **200** + non-array body `{"msg":"Large data set"}` (seen on `PayrollTaxData`). Treat a non-array 200 as "narrow the date range / chunk it", not as data.
- Rate limits: 60 req/min, 1000 req/hr, **only 20 token requests/hr** — so never re-auth per call. Docs require queuing + exponential backoff; avoid parallel bulk pulls.
- Responses are plain JSON arrays (no pagination param); large entities (TransactionItemData ~14k rows/30MB) must be pulled in date slices.

**Why:** Confirmed by a discovery probe hitting all 34 actions — all returned 200, none 403, so this tenant has full access.
**How to apply:** For any Zenople feature, fetch one token and reuse it; query per-entity with bounded UTC windows; chunk dates when a 200 returns `{"msg":"Large data set"}`. Data is highly sensitive (SSN/TIN/DOB/bank/EEO) — pull only needed fields and gate access. Discovery script: `artifacts/api-server/scripts/zenople-probe.mjs`.
