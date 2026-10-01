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

## Free-tool completion semantics (October 1, 2026)

`tool_completed` records one completed use per mounted tool or explicit reset:

- Bid scorecard: all seven questions have an answer. No and Need to verify both count as answered; completion does not mean the bid is ready or eligible.
- Capability builder: the statement is prepared. Editing and preparing it again does not count again until Clear all fields.
- Compliance matrix: the first CSV export containing at least one requirement is requested. Clearing the last row resets the count. Completion does not certify the requirements or prove that the browser saved the file.

`resource_download` remains a separate download-request event and can repeat. Neither event represents a unique person, a qualified lead, a trial or a purchase. Use the sanitized page path to compare tools. The existing GA4 consent, production-host, DNT/GPC and public-route gates still apply; no answers, requirements, company details or scores are included. No new key event or monetary value was configured.

Before this change, only the capability builder emitted `tool_completed`, on every preparation. Do not compare counts across this instrumentation change as if collection were consistent. Source: Google's custom-event setup guidance, https://developers.google.com/analytics/devguides/collection/ga4/events, reviewed October 1. Repository completion tests exercise the actual React components, including repeated interactions, explicit resets and payload limits. Deployment and GA4 receipt require separate verification.
