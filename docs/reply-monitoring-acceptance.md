# Reply monitoring acceptance

This change preserves existing automation, provider, trial and spending gates. It does not resume a paused account or authorize additional spending.

## Processing guarantees and limits

- Save an inbound communication before interpreting its text. Tenant plus provider message ID deduplicates it; incomplete capture resumes from its saved extraction/result checkpoint.
- Classify automatic notices and clear human declines before paid interpretation. Preserve the original envelope and raw text. Quoted prior messages do not supply opt-outs or decline evidence.
- Record ordinary absence notices without treating them as decisions or supplier coverage. A confidently matched departed-address notice holds that address across the tenant's records; a replacement contact is not created or emailed automatically.
- Explicit opt-outs hold the address account-wide and never receive acknowledgments. Delivery reports retain failed/delayed/unknown disposition and the actual invalid-mailbox, access-denied, mailbox-full or group-restriction cause. An ambiguous group response is not proof of an invalid mailbox.
- Close a decline only on its verified opportunity and trade, cancel that request's email schedules and prevent automatic reopening by later replies. Other trades and opportunities remain distinct.
- Check current suppression, uncertain sends and request state when work executes and again immediately before Gmail dispatch. A concurrent stop that commits before this final read blocks the attempt. A message already accepted by Gmail cannot be recalled.
- Acknowledge only a clear human decline with stable inbound-message deduplication, verified sender, exact thread and RFC Message-ID, and a fresh read showing no subsequent thread message. Automatic notices, opt-outs, bounces, departed contacts, changed/unreadable threads and uncertain prior sends receive no acknowledgment. The acknowledgment closes the request without another pitch.
- Preserve uncertain sends. A bounded Sent search with no match never releases a retry. A new send carries an intent marker; reconciliation needs its exact marker before recording a receipt. Historical messages without that marker require manual evidence review.
- An interpretation failure does not stop later notices in the same fetched page from being processed. Unfinished processing prevents cursor advancement. An explicitly paused account remains paused, including reply polling; this change does not override it.

## Local verification

Use synthetic organizations, addresses ending in `.test`, a disposable local database, mocked mailbox/provider responses, and blocked external network access. Cover decline to durable event to terminal state to canceled schedule to blocked follow-up to one acknowledgment, including repeated deliveries. Include cross-tenant and cross-trade negative cases, departures, opt-outs, absence, exact DSN causes, persistence failures, budget holds, changed threads, late stops and uncertain sends.

Run the repository unit suite, TypeScript check, canonical migrations/schema verification and the relevant reply, queue, threading, suppression and send-idempotency integration suites. Compile both web and worker with `scripts/build.mjs` from a clean committed tree. A local build is not deployment evidence.

## Historical reconciliation and live release gate

Do not run a broad history repair or replay the mailbox. For each approved historical message, verify the connected account, provider message and RFC IDs, exact tenant/opportunity/subcontractor/trade/communication IDs, saved reply/event, current suppression, queued schedules and any attempted or uncertain sends. Re-read the actual thread before considering an acknowledgment. Apply only the evidenced closeout or address hold through an authorized runtime route, record its result, and leave replacements untouched. If runtime access is denied or IDs cannot be verified, stop before mutation.

Before publication, preserve a verified recovery bundle and exact release tree, reconcile concurrent main/workspace changes, and import through the approved Git-to-Replit workflow. Obtain authorized hosted-check capacity where required; skipped CI is not a passing check. Never publish an unverified Replit workspace.

After publication, independently bind web and worker build evidence to the accepted commit/tree. Verify the worker heartbeat and reply-poll cursor/last-success state without increasing caps. Run the synthetic controlled-recipient reply flow through the actual service only with verified test ownership and transport authorization. Verify the resulting inbound/event/status/hold/queue and single provider receipt. Failure to obtain this evidence leaves live acceptance blocked; publication success alone does not establish it.
