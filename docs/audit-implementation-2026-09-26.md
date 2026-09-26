# Website audit implementation, September 26, 2026

This is an implementation record, not a claim that every audit recommendation is complete or that the changes are live. Brand styling, prices, trial quantities, tenant permissions, human approvals and spending caps are preserved.

## Implemented in this change

| Area | Change |
| --- | --- |
| Acquisition | Added the secondary walkthrough CTA; explicit trial allowances share the enforcement constants; signup has password visibility, a real text H1 and first-form-interaction tracking. Pricing explains cap behavior and includes an explicitly illustrative usage calculation. |
| Setup | Core integrations open by default. Optional setup items are collapsed. AI access copy covers supported platform services and eligible own keys. Getting Started distinguishes opportunity review from later outreach setup. |
| SEO | Page-specific title, canonical, Open Graph and Twitter metadata; one brand suffix; login noindex; omitted unreliable sitemap lastmod; unknown public paths reach the 404 while registered private prefixes remain guarded. |
| Content | Public /resources hub and eight source-linked guides. Guides include article and breadcrumb structured data, related articles and feature/trial paths. Public route registry powers middleware, XML/HTML sitemaps and llms.txt. No invented testimonials, certifications, customer outcomes or search volumes. |
| AI explanation | New scoring summaries use the final capped score and routed tier. Existing notes are disclosed as historical. The score card uses the current stored opportunity score and flags an older breakdown. New analyses store their creation time; the brief warns that current source and deadline checks remain necessary. |
| Reporting | Pipeline headline says recorded value, explicitly includes estimates, distinguishes the current-open scope from the period-filtered breakdown, and does not call it revenue or a forecast. Open tracking caveat now explains both inflation and undercounting. |
| Workflow clarity | Removed hardcoded auto-dismiss advice that contradicted saved rules. Explained task dates versus review timers and bid deadlines. All tasks naming, notification destination labels, missing compliance-document counts, quote-workspace empty state and draft-contact fallbacks are clearer. Repeated identical risk labels are grouped without deleting source flags. |
| Failure handling | Recognizes specified provider usage limits and reset-date language; scopes rejected-key advice to the affected provider. Normalized persistent account failures do not receive immediate queue retries. Transient rate limits remain retryable. Existing spending admission checks and caps remain unchanged. |
| Performance/accessibility | Decorative desktop video waits until the page has loaded and settled, uses preload=none and has a pause control. Phone, reduced-motion and data-saving fallbacks remain. New guides have bounded reading width and responsive type. Added all guide URLs to the accessibility sweep inventory. |
| Measurement | Added a bounded, rate-limited, same-origin anonymous marketing endpoint with strict event/path allowlists. No form values, query strings, referrers, cookies or visitor IDs are collected by it. Browser events honor DNT/GPC. Existing authenticated account/checkout events remain. |

## Search mapping

These are relevance and intent priorities, not verified volume or ranking guarantees. Search Console and paid keyword-volume data were not available for implementation.

| Intended query cluster | Canonical page |
| --- | --- |
| AI government contracting software | / |
| government bid management software | /platform |
| AI solicitation analysis | /ai |
| government subcontractor coordination | /subcontractors |
| Idaho government contracts | /resources/idaho-government-contracts |
| Boise government bids, Boise RFPs | /resources/boise-government-bids |
| Idaho government construction bids | /resources/idaho-government-construction-bids |
| Idaho janitorial government contracts | /resources/idaho-janitorial-government-contracts |
| government bid/no-bid checklist | /resources/government-bid-no-bid-checklist |
| proposal compliance matrix | /resources/proposal-compliance-matrix |
| subcontractor quote request checklist | /resources/subcontractor-quote-request-checklist |
| SAM.gov opportunity search | /resources/sam-gov-opportunity-search |

Official source links were checked on September 26, 2026. These guides are workflow content and should receive a subject-matter editorial review. They do not claim that BrostCo automatically monitors Idaho or Boise portals. BrostCo remains a national software product, not a local travel or generic lead-generation business.

## Event semantics

- `marketing_page_view`: a public page rendered in the browser. Distinct from legacy server `landing_view` and `signup_page_view` request events, which can include crawlers.
- `cta_click`: signup, tour or pricing destination plus header/content/footer placement.
- `signup_started`: first focus within the signup form, once per component mount, not a page view.
- `signup_error`: form submission returned a failure or could not be confirmed. No field values or error prose are included.
- `walkthrough_play`: first play of a controlled video per mounted page listener; decorative motion is excluded.

These are aggregate events, not a cross-device attribution system. Anonymous-to-account joins and experiment assignment are not implemented; do not calculate person-level conversion rates from these event counts alone.

## Verification

- Final full regression run: 4,717 passed, 738 skipped, zero failed. Skipped integration tests do not establish live provider or database behavior.
- Standalone TypeScript check passed.
- Production build passed with a bounded Node heap. An earlier concurrent build was killed during type checking; no type-check bypass was used. `BROSTCO_BUILD_NO_CACHE=1` is available for disk-constrained verification; normal builds retain their cache.
- Route-inventory, auth-boundary, analytics privacy, provider allowance, metadata, resource-link and media behavior regression checks were added or updated.
- No live account creation, payment, outreach, provider-key change or spending-cap increase was performed.
- Live current mobile layout and end-to-end staging checks remain unverified. The available cloud browser exposes no viewport-emulation capability. Adding routes to the sweep inventory is not the same as running that sweep.

## Still open, not silently marked complete

1. Durable provider-account backoff across scheduler sweeps and restarts, explicit reset/resume controls, recovery incident ownership and a verified successful live analysis. The immediate queue retry change is not a full durable circuit breaker.
2. The opt-in critical-event email system with recipient preferences, durable deduplication, escalation, delivery receipts/failures and staging delivery tests. This change surfaces existing channels; it does not implement that new email service.
3. Reconcile all Today/Review/Recap stale and expired work by shared deadline semantics and saved-rule consequences. The current change corrects explanations but does not rewrite the entire queue lifecycle.
4. Reconcile headline and detailed reporting under identical filters and add drill-downs to contributing records. Current copy discloses their different scopes; it does not claim they now use identical queries.
5. Full dashboard symptom grouping and terminology consistency across help, recorded videos and every record-specific surface. Current changes address targeted verified instances.
6. Live desktop/mobile matrix, keyboard/zoom/IME checks, form recovery, role tests and end-to-end trial activation in a safe staging account.
7. Repeatable Lighthouse/CrUX or equivalent field measurements, public caching/promo separation, font strategy and measured CSS/client-bundle reduction. No improved Core Web Vitals score is claimed.
8. Business-approved team identities, customer proof, legal retention specifics and verification of backlink metrics. No customer or legal facts should be invented to fill these sections.
9. Search Console ownership/access, sitemap submission, indexation monitoring, keyword volume and qualified-trial attribution. Choose subsequent content investments from observed queries and conversion evidence.

## Deployment and rollback

No database migration is required for this patch. Build and deploy the repository's standard web and worker services together, then verify public pages and auth-protected routes. The new analysis timestamp is an optional JSON field, so old records remain readable. Revert this implementation commit to roll back the code; no existing records were deleted or batch rewritten.

After deployment, check the resources index, each guide, signup allowances, page head metadata, a real public 404, a private-route redirect, event ingestion under privacy signals, the hero pause control and a sampled opportunity's current score versus historical notes. Perform real mail or billing checks only in an approved test workflow.
