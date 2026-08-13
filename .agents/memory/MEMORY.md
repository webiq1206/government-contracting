# Memory index

- [Dev environment quirks](dev-env-quirks.md) — NODE_ENV=production breaks next dev CSS & prunes devDeps; vitest 2.x is firewall-blocked, use 3.x.
- [Outreach email transport rules](outreach-email-transport.md) — never scrub a rendered email (it censors our own phone); scrub inputs, remove silently, guard at the transport.
- [Sub contact discovery](sub-contact-discovery.md) — MX-only emails stay unverified (no auto-send); SSRF guards for website scraping; api.sam.gov blocked in dev workspace; Hunter/Maps keys declined.
- [Entitlement gating](entitlement-gating.md) — one computed gate (suspended > comped > status/date); comp is its own column Stripe can't overwrite; worker org-selection drifts.
- [Support sessions](support-sessions.md) — impersonation is a marked session row; admin is an env allowlist answering 404; guards must sit at every mail/money sink, at the top.
- [Login email aliases](login-aliases.md) — one address across users + aliases, enforced by triggers under an advisory lock; sessions keep the canonical address.
- [AI drafts a human sends](ai-drafts-for-humans.md) — scrub every model-bound source, not just our own block; commitment checks warn instead of blocking; generate on demand and keep it.
- [Landing product film](product-film.md) — rendered frame-by-frame, not live; phone downscale sets a hard type floor; public assets need a middleware prefix or logged-out visitors get redirected.
