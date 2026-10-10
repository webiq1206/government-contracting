# Communication evidence

Migration 130 adds future email checkpoints, an original Date header for newly captured unmatched mail, and an explicit quote-to-inbound-message source. Apply the additive migration through the normal release process before serving the new build. No historical receipts, dates, associations, or quote sources are backfilled.

The communication write and its evidence event commit together. A failed pre-send checkpoint prevents the provider handoff. If the provider accepts but settlement cannot commit, the existing attempt stays uncertain and is not replayed. Confirmed refusal retries retain earlier content and state evidence. Sending-mailbox identity refers to the grant used by the Gmail client, checked again immediately before handoff; an unknown legacy identity stays unknown.

These are application checkpoints, not recipient-server delivery receipts or proof of Inbox versus Spam. A first observation of an older record is labeled as a later snapshot. Tracking events retain their specific meaning. The database owner can alter data, and parent deletion cascades to events; this is not a tamper-proof or indefinite-retention audit system.

Quote source references must identify an inbound email for the same tenant, solicitation, and supplier. Imported quotes whose original message date is unavailable remain under review rather than using ingestion time to establish freshness. Attachment names do not establish readable contents.

The read views are tenant-scoped and raw failure diagnostics retain the integration-management permission gate. Migration 130 follows the existing permissive-plus-restrictive tenant policy pattern and revokes untrusted PostgREST grants. It does not change production database roles or claim that previously staged runtime-role blockers are resolved.

For a code rollback, retain the additive schema and captured evidence. Do not drop the event table as part of an ordinary rollback. No production migration or provider call is performed by the synthetic tests.
