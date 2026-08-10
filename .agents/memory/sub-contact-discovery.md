---
name: Sub contact discovery
description: Rules and environment facts for subcontractor email discovery/verification and SAM checks.
---

- Email discovery ladder: Hunter (needs HUNTER_API_KEY, not set — user declined Aug 10 2026) → scrape sub's own website. Websites come from Google Place Details (needs GOOGLE_MAPS_API_KEY, also declined). Without either key, discovery can only work for subs with a website already on file; the hourly contact-recheck sweep retries every 7 days per sub, so adding a key later backfills automatically.
- **Rule:** a DNS MX check proves the domain accepts mail, not that the mailbox exists — scraped/MX-only emails must stay `email_verified=false` so outreach drafts them for operator approval instead of auto-sending. **Why:** code-review flagged auto-mailing unverified harvested addresses as unsafe; only mailbox-level verification (Hunter) gates unattended sends.
- **Rule:** any server-side fetch of an operator-editable URL (e.g. subcontractor website scraping) needs SSRF guards: http(s) only, resolve + reject private/loopback/link-local/CGNAT IPs on every redirect hop, manual redirects capped, streaming body-size cap.
- api.sam.gov is unreachable from the dev workspace (env proxy answers 404 with empty body via istio-envoy in ~2ms — for ALL SAM endpoints, even valid ones). SAM checks read "error/unverified" in dev; may work in production. Exclusions API is v4 (`/entity-information/v4/exclusions`); v2 is dead.
- Outreach follow-up rule: only schedule the 48h `follow_up_at` when the initial send actually succeeded, otherwise the follow-up sweep "follows up" on a never-sent draft.
