---
name: Sub contact discovery
description: Rules and environment facts for subcontractor email discovery/verification and SAM checks.
---

- Email discovery ladder: Hunter (HUNTER_API_KEY, not set) → Google Place Details website (GOOGLE_PLACES_API_KEY works as of Aug 2026) → key-free web-search website finder → scrape sub's own site. The hourly contact-recheck sweep retries every sub without an email every 7 days, no key/website gate.
- **Rule (Aug 2026 policy, replaces the old draft-only rule):** a scraped email that is on the sub's OWN domain AND whose domain has MX records is treated as sendable (`email_verified=true`, status `scraped_own_domain_mx_ok`); off-domain/free-mail or MX-missing finds stay unverified drafts. **Why:** operator chose scrape-first outreach without Hunter; own-site-published addresses are the business's chosen contact channel.
- Web search from this workspace: Brave Search HTML works with UA exactly `Mozilla/5.0` (browser-like UAs get JS challenges) but rate-limits ~1 req/30s; Bing degrades to first-word-only matches; DuckDuckGo (html/lite) serves bot challenges. Website candidates must be validated by homepage content (name phrase, or all name tokens + city/state) — domain-word matches alone pick wrong sites (jackpot.com for "Jackpot Janitorial").
- **Rule:** any server-side fetch of an operator-editable URL (e.g. subcontractor website scraping) needs SSRF guards: http(s) only, resolve + reject private/loopback/link-local/CGNAT IPs on every redirect hop, manual redirects capped, streaming body-size cap.
- api.sam.gov is unreachable from the dev workspace (env proxy answers 404 with empty body via istio-envoy in ~2ms — for ALL SAM endpoints, even valid ones). SAM checks read "error/unverified" in dev; may work in production. Exclusions API is v4 (`/entity-information/v4/exclusions`); v2 is dead.
- Outreach follow-up rule: only schedule the 48h `follow_up_at` when the initial send actually succeeded, otherwise the follow-up sweep "follows up" on a never-sent draft.
