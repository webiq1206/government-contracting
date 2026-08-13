---
name: Outreach email transport decisions
description: Durable operational rules for outreach email sending and automatic quote capture
---

- Reply detection works via Gmail polling OR the Resend inbound webhook (svix-signed, requires RESEND_WEBHOOK_SECRET + inbound domain setup in Resend). Resend-sent outreach correlates replies via a plus-addressed reply-to (`info+t<trackingId>@domain`); Resend's email.received webhook is metadata-only, the body must be fetched from the receiving API.
  **Why:** without webhook correlation, Resend-sent outreach had no thread id and replies could never auto-save; the webhook must fail loudly (502 + error log) when it can't read a reply so nothing is silently missed.
- Never email recipients bare in-app file URLs; external recipients have no login. All emailed document links must be time-limited signed links.
- Automatic quote capture must stay conservative: verified correlation (thread + sender ownership) and never overwriting human-entered data. Weak matches go to manual review.
  **Why:** an architect review flagged reply misattribution and silent quote overwrites as data-corruption risks; the user's bids depend on quote integrity.
- NEVER run the government-contact scrubber over an assembled/rendered email. Scrub solicitation-derived values individually, on their way INTO the template vars.
  **Why:** after token substitution the operator's own phone and email are byte-identical in form to the contracting officer's, so a whole-body pass censors Brost Co's own contact details. This actually shipped: a sub received "You can also call me at [CONTACT REDACTED]." The whole-body pass also protected nothing, because every government-derived value was already scrubbed on the way in.
  **How to apply:** any new recipient-facing string derived from a solicitation (title, agency, trade, scope, questions, document names) must be scrubbed at its source. Templates are operator-editable, so "the default template doesn't use that token" is not a defence.
- Removing something from a sub-facing email must be SILENT — no marker, no placeholder, no empty stub. Drop the clause or sentence that introduced the value instead.
  **Why:** the user's explicit standard is that these emails "must be absolutely perfect and sound 100% natural"; a visible marker or a "call me at ." gap is as damaging as leaking the value. Dropping beats repairing for contact directives — "Contact the CO for questions." would tell the sub to bypass Brost Co.
- A missing/blank template token collapses its sentence rather than rendering as "". Rendering blanks is a silent bug that only shows up in a real inbox.
- Emails are content-checked at the single transport choke point before any provider is selected, and a refusal is reported distinctly from a delivery failure (nothing was attempted; the fix is to the content).
