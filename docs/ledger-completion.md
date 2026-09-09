# Activity history and usage billing

All changes live in Git. No Replit Agent work is involved.

## Release

1. Pull main and run `npm ci` with Node 22 or later.
2. Run `npm run db:migrate` with the production migration-owner connection. Apply all pending migrations, including 114 and 115. Do not run the legacy checksum baseline again or seed an existing database.
3. Run the production schema check, build and republish. Restart the worker with the same release.
4. Open Activity Ledger in Work. Every account member can read their own account's history.
5. Open Admin → API Usage → Reconciliation and billing to connect reporting and configure collection.

Migration 114 imports existing source records as historical snapshots, then captures meaningful inserts, changes and deletions transactionally. Its runtime depends on the existing owner-runtime database model. RLS denies direct public client access. A large history can make this migration take longer than earlier schema-only migrations; keep runtime services on the existing release until it completes.

## Activity ledger

The new `/activity` page includes emails, texts, notes, calls, received and unmatched replies, quotes, bids, documents, opportunities, contracts, compliance, agent actions, job runs, API calls and invoices. It provides:

- Search across subjects, message contents, addresses, opportunity names and companies.
- Type, status, actor and date filters; newest/oldest ordering; focused views for attention, sent mail, replies, bid work and automation.
- URL-preserved filters and up to 12 named views saved on the current device, scoped to the signed-in user and organization.
- Full-range counts and 50-entry pages. Counts describe history entries, not unique messages, because a later delivery update is another event.
- Expandable contents and evidence, with links to the relevant opportunity or subcontractor and existing communication/API tools.
- Streaming CSV export of all matching entries, with a fixed entry-id ceiling so new activity cannot shift export pages. Spreadsheet formulas are escaped.
- Explicit loading, failure, retry and empty states; responsive stacked entries and keyboard-accessible details.

No send is inferred from a draft. "Sent" means handed to the provider, not proven arrival. Imported snapshots show the latest saved state, not reconstructed lifetime history. An attention entry is a recorded state at that time; its source may subsequently have been resolved. Old records with no stored human actor say "Account activity" instead of attributing them to the reader. Unmatched mail contains the stored snippet; the original full email remains in the connected inbox when the source never stored it.

Only allowlisted business fields enter the ledger. Credentials, raw integration responses, model inputs/outputs and underlying API costs are excluded. Existing automated log retention does not manufacture deletion events. Account deletion cascades its activity history. Historical source links may lead to unavailable records after deletion; the snapshot remains until the account is deleted.

## Provider reconciliation and coverage

- Existing metering continues for Anthropic, Google Maps, Hunter, Ahrefs and Twilio.
- Tenant-context SAM.gov, USAspending and BLS calls through the shared HTTP helper are recorded with zero provider cost. Their credential source is unknown, rather than inventing ownership for a public quota. Unscoped maintenance is not assigned to a customer.
- Anthropic reporting uses `ANTHROPIC_ADMIN_API_KEY`, distinct from the ordinary inference credential. The hourly production job fetches the previous seven complete UTC days with pagination. Decimal cents convert to dollars in PostgreSQL. Repeated reports update the same period rather than duplicate it.
- Anthropic reports cover the entire provider account, including usage outside BrostCo. Its aggregate reports are compared with ledger totals but do not prove individual request or tenant costs. They therefore do not automatically authorize per-tenant charges.
- Twilio retrieves prices for recorded message SIDs using the matching platform credential fingerprint. Account/SID and currency must match. Old credentials, missing provider IDs and unsupported currencies remain for review. Lookups rotate so a permanently unpriced message does not starve newer receipts.
- The exact-receipt importer supports every recorded provider. It requires the ledger ID, matching provider request ID, USD cost and evidence. Duplicate or already invoiced records stop the atomic import.
- External usage import supports other attributable service receipts, including services without a built-in execution adapter. Every record requires an organization, service, feature, timestamp, unique request ID and evidence. It is not automatic instrumentation of unconnected providers. Shared flat infrastructure costs must not be arbitrarily attributed as customer requests.
- Only a matching supported service preference accepted before execution can make imported platform usage billable. All other platform receipts are held for review. Own-account use stays nonbillable.

Provider APIs do not all expose attributable request receipts. Connecting a provider's reporting key is an operational prerequisite, and evidence import is still required where that provider only supplies aggregate bills. No production provider credentials or billing reports were accessed during development.

## Billing periods and collection

Stripe subscription item timestamps supply authoritative periods, including non-calendar and annual subscriptions. Mixed-period subscriptions require review rather than guessing. Administrators can sync a period and enable automatic usage collection per tenant. Enabling synchronizes the current period and records who enabled it. It does not alter subscription pricing or paid-use acceptance.

The production worker runs reconciliation and billing hourly with a database lease and a process concurrency guard. It does not run automatic collection against the isolated development database. Procurement pause does not stop reconciliation of existing usage.

At least two days after a recorded period closes, confirmed accepted usage is invoiced and finalized with Stripe automatic collection. Late confirmations and sub-cent balances carry forward. Unconfirmed usage is held. Existing manually prepared attempts must be reviewed before scheduled billing proceeds. Automatic billing starts from recorded periods after enablement, so the first bill is not guessed from an unknown historical anniversary.

Drafts can also be finalized from the admin page. The Stripe invoice's organization and batch metadata must match before collection. Verified Stripe webhooks remain authoritative for invoice payment status. A successful request to finalize is not a claim that payment succeeded.

## Credits and refunds

The admin page creates actual Stripe credit notes, either reducing an open invoice, crediting a paid account's future balance, or refunding a paid invoice. Adjustments have durable request IDs, tenant/batch ownership checks, a database lock and a cap that reserves pending amounts. Stripe's credit-note limits also cover changes made outside this app. Partial adjustments are recorded separately instead of marking every usage row fully refunded. Settlement checks distinguish submitted, pending, refunded, failed and voided outcomes. The hourly worker refreshes recorded credit notes. Administrators can resume saved attempts or recover a matching Stripe credit note after an interrupted response; ownership, invoice, amount and adjustment metadata must all match.

Retries of the same request reuse one Stripe idempotency key. An unresolved attempt older than 20 hours requires review in Stripe before any further write. Do not start a replacement request after a timeout without checking the stored pending adjustment. The tenant API shows its own adjustment amount, reason and status, without provider costs or markup.

## Verification and activation boundaries

Tests run against disposable PGlite databases and mocked providers/Stripe. They cover full migrations, tenant isolation, meaningful history changes, draft versus sent, complete-range pagination, secret/cost projection, CSV formula protection, exact decimal costs, authoritative item periods, partial refund idempotency, over-refund refusal, cross-tenant refusal, and provider cents conversion.

Production provider-to-payment verification requires connected reporting credentials, a selected test account and a Stripe test-mode payment flow. No customer was charged in development. The browser-act daemon failed to start, and the local Chromium download was blocked by the workspace network allowlist. Desktop/mobile visual verification and a live authenticated production review remain unverified.

References used for implementation:
- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://platform.claude.com/docs/en/api/admin/cost_report/retrieve
- https://www.twilio.com/docs/messaging/api/message-resource
- https://docs.stripe.com/api/invoices/finalize
- https://docs.stripe.com/api/credit_notes/create
