---
name: Outreach email transport decisions
description: Durable operational rules for outreach email sending and automatic quote capture
---

- Reply detection works via Gmail polling OR the Resend inbound webhook (svix-signed, requires RESEND_WEBHOOK_SECRET + inbound domain setup in Resend). Resend-sent outreach correlates replies via a plus-addressed reply-to (`info+t<trackingId>@domain`); Resend's email.received webhook is metadata-only, the body must be fetched from the receiving API.
  **Why:** without webhook correlation, Resend-sent outreach had no thread id and replies could never auto-save; the webhook must fail loudly (502 + error log) when it can't read a reply so nothing is silently missed.
- Never email recipients bare in-app file URLs; external recipients have no login. All emailed document links must be time-limited signed links.
- Automatic quote capture must stay conservative: verified correlation (thread + sender ownership) and never overwriting human-entered data. Weak matches go to manual review.
  **Why:** an architect review flagged reply misattribution and silent quote overwrites as data-corruption risks; the user's bids depend on quote integrity.
