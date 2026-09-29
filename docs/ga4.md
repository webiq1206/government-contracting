# BrostCo GA4

Configured September 29, 2026.

- Account: Websites (BRC, BCC, REC, ASOS), `396104300`.
- Property: BrostCo, `556607163`, standard/free, America/Boise, USD.
- Web stream: BrostCo Website, `15867696078`, https://brostco.com.
- Measurement ID: `G-5KK7K8WMRV`. This is a public identifier, committed with the integration so deployments need no new secret.
- Key events: `sign_up` and the built-in `purchase`. Signup has no invented monetary value.
- Enhanced Measurement remains enabled. Its automatic browser-history page views are off because the application sends exactly one sanitized page view per public route transition. Initial automatic configuration page views are also off in code.
- Email redaction is enabled, along with 22 sensitive URL parameter keys.

## Collection

Google loads only on the production hostnames after optional analytics consent. The shared analytics preference covers both GA4 and Clarity. The new consent version asks existing Clarity visitors for a fresh choice when adding Google. Do Not Track and Global Privacy Control are honored. Advertising storage, advertising user data, advertising personalization, and Google signals are disabled.

Page views cover the declared public website and checkout confirmation. Private workspace pages, record identifiers, and unknown paths are excluded. Page titles come from the public route catalog, query strings are excluded from custom events, and referral URLs retain only the referring origin or a known public BrostCo page. Existing allowlisted campaign attribution is reused.

Existing CTA clicks, signup starts/errors, product walkthrough plays, resource downloads, and completed free tools also reach GA4 after consent. Successful account creation sends `sign_up` and `trial_started`; only `sign_up` is a key event to avoid counting one trial twice in acquisition totals.

On return from paid checkout, the server verifies a live, complete, paid Stripe session belongs to the signed-in organization. It sends the actual USD paid amount, plan, billing interval, and a SHA-256 transaction reference. Test, unpaid, zero-value, foreign-organization, and impersonated sessions do not produce purchase events. Events are deduplicated in the tab and by transaction ID. Recurring invoices and purchases whose visitors never return or decline consent are not reported by this browser integration. Billing remains the financial source of truth.

## Verification

The focused tests exercise consent, privacy signals, production-host restrictions, route deduplication, private-page exclusion, parameter filtering, signup delivery timeout, purchase deduplication, Stripe ownership checks, actual paid amount, and provider failures.

After deployment, accept analytics on a production public page, navigate to another public page, and confirm `page_view` and interactions in GA4 Realtime. Decline analytics in a fresh context and confirm the Google tag is absent. Successful signup and purchase events must come from actual successful workflows; do not create fake production conversions for verification.
