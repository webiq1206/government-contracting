# Memory index

- [Dev environment quirks](dev-env-quirks.md) — NODE_ENV=production breaks next dev CSS & prunes devDeps; vitest 2.x is firewall-blocked, use 3.x.
- [Outreach email transport rules](outreach-email-transport.md) — never scrub a rendered email (it censors our own phone); scrub inputs, remove silently, guard at the transport.
- [Sub contact discovery](sub-contact-discovery.md) — MX-only emails stay unverified (no auto-send); SSRF guards for website scraping; api.sam.gov blocked in dev workspace; Hunter/Maps keys declined.
- [Landing product film](product-film.md) — rendered frame-by-frame, not live; phone downscale sets a hard type floor; public assets need a middleware prefix or logged-out visitors get redirected.
