# Controlled opportunity preview

This is the B01/B02 prospective safety boundary. It is **disabled for activation by default**. Deploying it does not recover a provider, activate a hold, settle a historical receipt, send mail, or run an opportunity. It is not a complete procurement workflow or a live acceptance receipt.

## What is bounded

The platform administrator prepares one active, open opportunity with a verified future deadline. The saved scope binds organization, opportunity, pursuit version, full relevant input hash, a maximum 12,000-character excerpt, contract/system prompt, output limit, exact provider/model, credential/configuration identity and configured pricing. Supported transports are GPT-4.1 and pinned Haiku 4.5; fallback, hidden retries, documents, profile injection and tools are absent. Model text is an **unsent preview**, never a decision, verified citation, attachment inspection, quote, or bid.

Only the dedicated executor mints its private in-process execution authority. HTTP/queue `owner`, `workKey` or operation IDs cannot authorize provider dispatch. No ordinary agent handler runs. Results and evidence are saved in preview/usage/receipt tables; opportunity, supplier and communication records are not promoted or changed. Repeated execution of completed unchanged work returns its saved result. A changed key, prompt, pursuit version or configuration cannot replay uncertain work under the old scope.

The optional provider recovery step consumes the **same** all-time approved reservation and attempt envelope. Full-plan preflight runs before activation and ownership; each actual admission rechecks it under the existing global usage lock. Exact decimal arithmetic is used. Missing approval/reference/cap/request count permits zero paid attempts. Configured per-million prices and conservative bounded text/output checks establish admission evidence, **not a provider invoice, account balance, verified actual charge, or provider-enforced spending limit**. Current price/account authority must be independently established before a paid canary.

## Activation affects the whole platform

Shared credentials make a tenant-only recovery hold insufficient. An active preview holds ordinary agents, enqueue calls, all metered requests and **all Gmail sends, including platform system mail/password resets/recaps**, across organizations. Existing uncompleted dispatch claims, pending provider/usage attempts or running jobs prevent activation. Claims never expire automatically. A usage row aging from pending to failed cannot erase its separate API dispatch claim. Old rows are not backfilled, settled, reassigned or replayed.

Before enabling activation, the deployment operator must verify the reviewed web and bundled worker build, verify the intended database connection, stop/drain every old executor, and have explicit authority for this platform-wide interruption and exact paid scope. Then, and only then, configure `BROSTCO_PREVIEW_ROLLOUT_REFERENCE` with the saved rollout/drain approval reference. This setting is **an operator assertion**, not automatic fleet-drain proof. A recent heartbeat alone is insufficient. No source change automatically sets this environment value.

The hold persists after successful preview completion. Explicit release is a separate administrator action. Running or held/uncertain operations cannot be released, reclaimed or replayed by elapsed time. There is intentionally no emergency reset or historical reconciliation endpoint in this feature. A purely local preflight rejection leaves a prepared operation unowned. A later configuration change or uncertain provider/commit result can retain the hold and requires a separately reviewed response.

## Administrator API

`/api/admin/opportunity-preview` requires the existing non-impersonated platform-admin guard. Responses are private/no-store. POST accepts one strict action:

- `dry-run`: `input` with `orgId`, `opportunityId`, `idempotencyKey`, `model`; optional `recovery`, decimal-string `approvedUsd`, `maxRequests`, and `approvalReference`. Defaults are zero dollars, zero attempts and no approval. Reads only: no operation, receipt, queue, business or provider write.
- `prepare`: same input. Saves immutable local authority/evidence, without activating or executing it. A conflicting logical scope or idempotency key is rejected.
- `activate`: prepared `id` and the exact operator-configured `rolloutReference`. Requires no outstanding dispatch and enough allowance for every prepared step.
- `execute`: admitted `id` only. No caller prompt, credential, owner token or recipient is accepted. It can perform only its optional bounded recovery and one bounded analysis.
- `release`: completed or never-executed `id` plus `rolloutReference`, with no outstanding dispatch.

GET with `?id=<preview-id>` returns bounded state/result evidence and whether the platform hold remains. Raw credential identity, private owner token and stored prompt are excluded. There is no send mode or receiver override. Use reviewed existing sender/recipient authorization for a future separately bounded mail workflow; this endpoint cannot send.

## Runtime evidence

`npm run build` embeds the same source commit/tree, build UUID, UTC build time and lockfile SHA in Next and a bundled first-party worker. Dirty/unverifiable builds return no verified source identity. A source change during a clean build fails the build. Production `npm run start:worker` verifies the named artifact's SHA against the manifest before import. Local TypeScript worker commands remain unverified and cannot obtain build proof from inherited environment strings.

Authenticated GET `/api/admin/worker-evidence` returns the web build, the stored worker heartbeat/build/artifact SHA and a hashed observation of the database name/server address/port. It omits raw heartbeat detail, connection names/addresses and credential material. This connection fingerprint is **not a globally unique verified cluster identity**. Lockfile SHA describes the lockfile, not measured installed third-party dependency bytes. One worker row does not prove every old executor stopped or that jobs/provider work succeeded.

For acceptance, retain the exact source/tree/build/artifact identities, route and role, UTC timestamp, fixture ID, expected/actual UI-storage-job-provider-receiver outcomes, and failure/retry evidence. Local unit/database tests and a worker boot are separate from production browser/device and provider/receiver acceptance. Historical 38 holds/$328 and three pending receipts remain protected evidence, not new approval or fixtures to clear.
