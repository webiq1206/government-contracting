---
name: outreach-email-transport
description: Outreach email runs entirely on per-tenant Gmail OAuth; Resend was removed.
metadata:
  type: project
---

Outreach email is Gmail only, per tenant. Each org connects its own inbox with
one button and `integration_tokens` is keyed `(provider, org_id)`, so sending,
reply reading, and thread history all happen in the mailbox the customer
authorized. Platform system mail (password resets, digests, alerts) goes out
through the founding tenant's inbox via `lib/integrations/system-mail.ts`.

**Why:** one shared connection meant every tenant sent from whichever account
authorized last. Gmail also keeps sending and reading in the same mailbox, so a
reply is a real thread rather than something correlated by guesswork.

The From address is a Gmail "Send mail as" alias chosen from Google's own
verified list, never typed. Reading it needs no extra scope: `gmail.readonly`
and `gmail.modify` both authorize `users.settings.sendAs.list`.

**Why:** Gmail refuses a From it has not verified, so Google is the only
authority on which values are legal, and a text box would eventually hold one
of the illegal ones. It follows that an unidentified mailbox cannot be a
sending identity: a grant whose account address could not be read must not be
stored at all, because the connection then looks healthy while mail goes out
under whatever address was there before. A chosen alias survives a reconnect
only on proof of the same mailbox.

The alias only sets the From and Reply-To. Replies are still read from the
authorized mailbox alone, so mail addressed to the alias has to be delivered
there or reply matching silently stops. Nothing in the API can prove that; only
a real reply can.

**How to apply:** never reintroduce a second transport. Resolve identity with
`resolveOutreachSender(orgId)` and pass `orgId` explicitly for platform mail so
a reset never goes out from a customer's mailbox. Note the open constraint:
`gmail.send`/`readonly`/`modify` are restricted scopes, so customers outside the
founding Workspace need Google verification plus a CASA assessment.
