# Memory index

- [Dev environment quirks](dev-env-quirks.md) — NODE_ENV=production breaks next dev CSS & prunes devDeps; vitest 2.x is firewall-blocked, use 3.x.
- [Outreach email transport rules](outreach-email-transport.md) — never scrub a rendered email (it censors our own phone); scrub inputs, remove silently, guard at the transport.
- [Sub contact discovery](sub-contact-discovery.md) — MX-only emails stay unverified (no auto-send); SSRF guards for website scraping; Hunter/Maps keys declined.
- [SAM.gov API quirks](sam-api-quirks.md) — an unknown api_key comes back as an empty 404, not 401/403; test a key the way the app resolves it, not from process.env.
- [Entitlement gating](entitlement-gating.md) — one computed gate (suspended > comped > status/date); comp is its own column Stripe can't overwrite; worker org-selection drifts.
- [Support sessions](support-sessions.md) — impersonation is a marked session row; admin is an env allowlist answering 404; guards must sit at every mail/money sink, at the top.
- [Environment-driven accounts](env-driven-accounts.md) — provisioning from a secret creates, never overwrites (it locked the owner out); a test run must prove its database is disposable.
- [Login email aliases](login-aliases.md) — one address across users + aliases, enforced by triggers under an advisory lock; sessions keep the canonical address.
- [AI drafts a human sends](ai-drafts-for-humans.md) — scrub every model-bound source, not just our own block; commitment checks warn instead of blocking; generate on demand and keep it.
- [Negotiated terms](negotiated-terms.md) — free months are a 100% coupon, a free account is our own flag; claim an invitation before creating anything; bind invited checkout.
- [Queue jobs](queue-jobs.md) — a payload never names the tenant (the run endpoint is public); a deleted record is permanent, not retryable; keep the log line, drop the dead link.
- [Production topology](production-topology.md) — worker "connection timeout" = sleeping scale-to-zero instance, not a busy DB; dev/prod must not share a database.
- [Diagnosing a lockout](lockout-diagnosis.md) — check whether the site can reach its database before believing a password is wrong; a guard that fails closed in production can outweigh the risk it prevents.
- [Landing product film](product-film.md) — rendered frame-by-frame, not live; phone downscale sets a hard type floor; public assets need a middleware prefix or logged-out visitors get redirected.
- [Worker boot that hangs](silent-boot-hang.md) — a dead socket never rejects; bound every query, narrate every boot step, never cache a failed start.
- [Worker liveness](worker-liveness.md) — a job log cannot tell "gone" from "idle" from "stuck starting"; a phase-carrying heartbeat can.
