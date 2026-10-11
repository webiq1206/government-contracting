# BrostCo AI failover: staged rollout

This change is disabled by default. `BROSTCO_AI_FAILOVER=true` only changes routing for organization `00000000-0000-4000-8000-000000000001`. Other organizations retain their configured routing. No migration, provider call, budget edit, queue recovery, email send, or live activation is part of deploying this code.

When enabled, routine and complex defaults use OpenAI `gpt-4.1`, with Anthropic `claude-haiku-4-5-20251001` available once per completion after a known credit or capacity refusal. Legacy explicit model callers retain their provider and task tier but use these reviewed model versions. A task-tier flag still enforces the existing complex-work spending control. Haiku 5.5 is not included in this rollout.

## Admission and output

- Known credit exhaustion, rate limits, and typed Anthropic overload refusals can use the other configured provider. Authentication/access failures, explicit account/project spending limits, validation errors, safety refusals, unknown transport outcomes, and generic server errors cannot authorize a switch.
- There are no hidden SDK retries. One completion makes at most one primary and one fallback attempt. JSON correction is limited to one additional completion for parse/schema failures or token truncation: at most four provider attempts in that logical JSON operation. A returned refusal or content filter never triggers correction.
- Rate limits keep a durable minimum 60-second cooldown and preserve a longer supported Retry-After. A supplied delay that cannot be safely represented requires manual reconciliation instead of being shortened. Known permanent account refusals remain held until an explicit, authorized recovery succeeds.
- Both providers use the existing shared serialized spending ledger. Each attempt requires finite token pricing, a positive request reservation, and a finite shared dollar limit. Refused/uncertain attempts retain their provisional reservation until reconciled. Recorded estimates are not provider invoices, and configured limits are not user spending authorization.
- Provider-account pending tokens survive ambiguous transport, malformed response, or uncertain persistence outcomes; age alone never releases them. Existing health/incident surfaces expose these saved holds. No external alert is sent by this change.
- BrostCo v2 receipts omit routing/transport policy and mutable validator objects from logical identity. Cached text is locally validated. Known terminal outputs are cached before rejecting them to the caller, so identical rejected work does not pay again and unrelated work is not frozen. An unresolved v2 receipt holds further tenant AI work even when incidental queue payloads change.

## Required rollout order

1. Deploy this dual-reader code with the flag **off**. Preserve the normal source recovery bundle, exact tested tree, and publication receipt.
2. Prove every pre-reader web and worker process has stopped before enabling. A rolling deployment with an old worker remaining is not safe. All new readers serialize receipt transition; old binaries do not participate in that lock.
3. Use the admin-only, read-only `GET /api/admin/ai-readiness` to capture provider binding source, actual scoped routes, prices, budget settings, and legacy/v2 receipt counts. It neither probes a provider nor resumes work. Inspect current pending provider/ledger claims separately before spending.
4. Reconcile legacy pending **and completed** receipts through an explicit audited mapping if any exist. Old hashed input does not identify a safe v2 mapping. Do not delete receipts or guess a mapping. This change deliberately blocks activation against opaque history; it does not include a reconciliation mutation.
5. Obtain explicit spending authority and rollout scope. The user request for two-provider fallback does not approve displayed dollar limits, purchasing credits, or draining the backlog. Require an isolated, bounded canary before scheduled work; this change does not expose a canary runner and the global flag must not be used as an isolation mechanism.
6. After an approved canary, inspect both attempt receipts, output/schema validation, costs/reservations, absence of downstream sends, and pending claims. Then separately authorize scheduled work and its shared cap before enabling it.

Once any v2 receipt exists, this dual reader continues using v2 identity even when the flag turns off. Rollback must retain dual-reader code. Never roll back to a binary that only understands legacy identity after activation.

## What offline validation cannot establish

Fixtures establish refusal boundaries, receipt replay behavior, local schema checks, pricing admission, and database concurrency. They do not prove live provider credit, exact deployed process configuration, actual model quality on customer work, full browser acceptance, or delivery of an email. A prior connection-test receipt cannot establish JSON/PDF task quality or authorization for additional spending.
