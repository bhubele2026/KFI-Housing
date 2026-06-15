# Roadmap — Live QBO + Email auto-ingest

These need live credentials / OAuth that can't be wired from the dev sandbox.
They run on Replit (where secrets + the DB live). Captured here as the build plan.

## 1. Live QuickBooks Online (QBO) — see rent charges / sync invoices
The app already has QBO scaffolding: `artifacts/api-server/src/routes/qbo.ts`,
`src/lib/qbo-sync.ts`, `qbo-mapping-rules`, and a `/qbo/mapping-rules` page.
To go live:
1. Create an Intuit developer app → get Client ID/Secret; set as api-server
   secrets `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENV`.
2. Implement the OAuth2 connect flow (authorize → callback stores realmId +
   refresh token in a `qbo_connection` table). Refresh tokens on use.
3. Read path: pull Bills/Invoices/Vendors via QBO API; map vendor→property via
   the existing qbo-mapping-rules; surface "rent charges" on the property and a
   Bills view (reuse the Lanyard invoice model already harvested).
4. Reconcile against lease rent (we already flag invoice>lease deltas).

## 2. Email auto-ingest of bills + leases
Today bills/leases were harvested manually via the M365 connector. To automate:
1. Microsoft Graph app registration (application permissions Mail.Read) +
   secrets; or a shared-mailbox subscription/webhook for `bhubele@kfistaffing.com`.
2. Scheduled job (the app has schedulers) that:
   - pulls new mail from `account-services@inform.bill.com` / `invoice@hq.bill.com`
     / `accounts@lanyardstays.com`, parses invoice line items (parser logic already
     proven in `imports/lanyard-invoices.json`), upserts bills per property.
   - detects lease emails ("lease is ready/executed for Housing Request #…"),
     extracts terms, creates/updates the lease (needsReview when scanned).
3. Attach source PDFs to object storage (the app already has GCS upload via
   `/api/storage`).

## Data already captured (feeds the above)
- `imports/lanyard-invoices.json` — every Lanyard invoice + line items
- `imports/rental-companies.json` — landlord/vendor contacts + portals
- `imports/housing-import-consolidated.json` — properties/leases
- `imports/sharepoint-harvest.json`, `imports/email-harvest-2026-06.json`
