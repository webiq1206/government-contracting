# Mail recovery evidence and release checks

This change preserves existing messages and provider IDs. It adds a durable manual-send request, receipt/attempt timestamps, sender evidence, and explicit queued/attempting/unknown outcomes. An interrupted or uncertain request is never automatically replayed. A confirmed hold or HTTP refusal permits a person to prepare a new request after reviewing the cause.

It also fixes two current sent-count calculations, normalizes imported and extracted text before PostgreSQL writes, honors known contacts' unmatched opt-outs, invalidates verification when an address changes, and fences reply-cursor writes against reconnects and concurrent scans. Reconnecting a different mailbox cannot carry the previous mailbox's refresh token or cursor.

## Evidence boundaries

- September recap labels are historical reports, not delivery receipts. Do not infer that all messages were sent, or that no messages were sent, from those labels. Reconcile provider message IDs and Gmail Sent records, then separate provider acceptance from recipient delivery/bounces and genuine replies.
- The current connected assistant apps do not expose `brostcoholdings@gmail.com`. This does not establish the app's OAuth status or erase that mailbox's history.
- The supplied recap evidence names September NUL-byte ingestion failures, quota errors, and an October token-refresh failure. Current source already includes charset/NUL decoding and bounded Gmail pages. Additional persistence-boundary normalization closes remaining paths; this is not proof that current production uses that code.
- The production mailbox, selected alias, current OAuth failure, automation pause/allowance, and the two cited unanswered reply records still require a read-only inspection of the actual production deployment. Do not reset counters, loosen safeguards, or replay the backlog to diagnose them.
- Automated outreach has separate legacy send/record paths. The new durable manual-send claim does not establish crash-safe exactly-once behavior for every scheduled sender. Audit those paths before any backlog replay.

## Sender and signature

The requested ordinary identity is `BrostCo <hello@brostco.com>` with Reply-To `hello@brostco.com`, using the actual authorized mailbox `hello@webiq.co`. Select it through the existing verified Gmail send-as endpoint/UI after confirming the app's current connection; do not infer application authorization from assistant connector settings. Preserve legacy mailbox addresses for correlation.

Manual replies now render this signature when the founding account has selected hello@brostco.com; the exact rendered text is stored before sending. Existing automated templates still need their profile/signature settings inspected during the live-account review. No invented contact details:

```
BrostCo
Procurement & Project Coordination
hello@brostco.com
https://brostco.com
```

Gmail API sends need the signature in the application's rendered message; Gmail's web-composer signature alone does not establish that it was included. Verify the stored rendered body and MIME From/Reply-To using synthetic fixtures before release. Do not send subcontractor test mail.

Cold prospecting remains a separate decision. Do not provision a subdomain, add another transport, change credentials/scopes, or enable a new stream here. A subdomain is not a guarantee of main-domain reputation isolation. Google's sender guidance requires authentication and appropriate recipient practices; Resend's acceptable-use policy must not be treated as permission for cold outreach. Review provider permission before enabling that stream.

Sources checked: https://support.google.com/a/answer/81126 and https://resend.com/legal/acceptable-use .

## Release

1. Preserve the Replit-only source and verify the exact production deployment SHA, target database, runtime role, and restorable recovery point. A successful publication receipt is not a commit identity.
2. Review exact-head CI and independent review results. Migration 127 must follow provider migrations 125–126 and precede this runtime. It adds columns/index/check values; it does not backfill guessed identities or delivery outcomes.
3. Import the reviewed GitHub source into the correct Replit app and publish only through the authorized release path after preflight. Do not edit with Replit AI.
4. Read-only acceptance: identity/settings, current automation hold, current Gmail failure and success timestamps, scoped sent counts, persisted uncertain states, the Mainscape and Old Dominion reply histories, and the Communications display. No real test sends, paid model probes, counter resets, or blind replay.
5. Historical backfill requires message-level provenance, tenant/mailbox ownership and provider-ID deduplication. The existing repair script is dry-run by default; no live history rewrite was executed for this change.

Screenshot review remains incomplete: Library resolved IMG_1124.png, IMG_1125.png, and IMG_1126.jpeg, but the supported Windows transfer helper failed at `os.setxattr` and left no readable files. No pixel review was claimed.
