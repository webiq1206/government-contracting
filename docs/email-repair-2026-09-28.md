# Email sending investigation, September 28, 2026

## Production observations

- The homepage and authenticated dashboard loaded.
- Gmail settings showed Working and the sender hello@brostco.com, connected through the hello@webiq.co mailbox.
- The attached platform recap arrived, but its zero-email figure counted communications records and excluded the recap itself.
- The inbox showed 232 drafts. Recent examples were Sources Sought responses, which require human review and sending.
- The most recent outreach attempts were held before sending because document package links were unverified. Earlier holds included missing location information and inaccessible PDFs.
- Subcontractor verification history included missing contact information and exhausted SAM call budgets. These remain real gates, not evidence that Gmail is broken.
- Platform health said Operating normally while listing daily-recap sender failures. Its Email delivery card counted successful maintenance runs without proving a message had left.

## Repairs

1. Deduplicate original attachment URLs against stored document source identities. Rotated API keys do not create a second document. A fetched, attached file no longer gains a duplicate unverified link that blocks sending. Trade exclusions also remain effective. Different document selectors and failed storage reads still block when appropriate.
2. Exclude superseded document rows from new outreach packages.
3. Let recovery recheck verified pending pairings held for incomplete outreach, in addition to drafts and failed sends. Expired, removed, self-performed and inactive pursuits remain excluded. The ordinary outreach agent still validates the packet and enforces suppression, pause, tenant and duplicate-send controls.
4. Report current outstanding drafts and outreach holds in the platform recap, including work older than the reporting day. Clarify that the recorded-send total excludes system recaps and alerts.
5. Base the email health card on recorded provider handoffs and failures. Include previously unmapped agents, including daily-recap, in the overall service assessment. Classify the known platform-sender failure as a mailbox issue.

## Verification and deployment

Regression coverage exercises duplicate references, trade exclusions, distinct source files, storage failures, recovery eligibility, old drafts, and real reporting queries against a disposable PostgreSQL-compatible database. The existing email safety controls remain in place.

No production database migration is introduced. No customer or subcontractor message was manually sent during this investigation. Sources Sought drafts were not bulk sent or approved.

Replit's browser workspace remained behind its security verification screen. GitHub code completion does not establish deployment completion. The repaired revision must be pulled into the existing Replit workspace and published before the production sending path can be verified against it.

The entire platform is not certified flawless by this repair. Live provider delivery, outstanding document/contact gaps, Ahrefs access and human review decisions require their own evidence. A healthy connected mailbox alone does not resolve those dependencies.
