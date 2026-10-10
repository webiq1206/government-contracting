# Provider failure evidence review

The saved production failures established OpenAI HTTP 429 and Ahrefs HTTP 403, but did not record enough evidence to distinguish the underlying account/access cause. This change retains bounded diagnostics from future ordinary requests; it cannot reconstruct those historical causes or verify a provider account.

## Behavior

- Record HTTP status, allowlisted provider code/type, validated request ID, and bounded Retry-After seconds. Unknown or unsafe values are omitted with a fixed privacy label. Raw provider messages, prompts, email, bodies, headers, credentials and exception causes are not copied into these fields.
- Preserve this evidence through OpenAI/Anthropic error normalization, metered HTTP/Ahrefs requests and connection-test response handling. HTTP-200 failed/malformed bodies retain the observed status and unresolved cost treatment. Failed connection tests record only the fixed request unit, excluding arbitrary usage field names.
- Keep explicit OpenAI allowance codes, rate errors, and unclassified 401/403/429 refusals distinct. A generic `insufficient_quota` does not prove a zero credit balance. Type-only `rate_limit_error` remains transient. Unclassified refusals are held for review.
- Show the fields only in administrator failed-request details. Tenant usage projection continues to exclude diagnostics, configuration references and provider request IDs.
- Migration 131 adds two nullable JSONB columns. Existing rows stay unknown; there is no backfill or provider recheck. The standard schema migration gate must run before this application version serves requests.

## Configuration evidence and precedence

`orgApiKey` resolves an explicitly selected, accepted platform connection first. Otherwise the tenant's saved credential wins; an explicitly selected tenant connection does not fall back. Without that preference, an eligible grant or trial can use the platform connection, and only the founding organization can fall back to its platform environment. The existing tenant cache lasts ten seconds.

`platformApiValue` prefers the founding organization's saved encrypted setting over the deployment environment; an unreadable saved setting fails rather than falling through. The diagnostic callback observes that existing resolution without a new lookup or secret read by this review.

`requestIdentity` compares the actual transmitted value against current matched configuration. A matching platform value takes precedence for billing even if duplicated in a tenant setting. The saved reference records the matched store, BrostCo setting-owner UUID and allowlisted setting name. It does not prove which duplicate source supplied the value, a current connection, or a provider billing organization/project/workspace. No provider account identifier is configured in this path, so the UI says **Provider billing account: Not recorded**.

## Verification and review

Local fault injection exercises real error normalization and the PGlite ledger/facts SQL, including secret/prompt/mail reflections, arbitrary failed-usage field names, type-only rate errors, quota and ambiguous refusals, HTTP-200 uncertainty, request-ID rejection, configuration precedence, tenant projection and unchanged no-replay handling after persistence failure. Synthetic credentials and responses are used; no provider request or live database is involved.

Independent source review found and then verified corrections to the connection-test response path and HTTP-200 status preservation. The revised worktree had no remaining actionable findings. Exact commit/tree and final local/CI outcomes are maintained in the parent handoff receipt; previous timestamp-only PR 186 CI is not evidence for this combined tree.

## Deliberate limits

- Retry-After is recorded evidence. Existing immediate/queue retry scheduling is unchanged and does not enforce a durable credential-scoped cooldown. No delayed automatic recovery is promised.
- Existing Anthropic classification still uses broad authentication/allowance heuristics; this patch removes free-form suffix copying but does not redesign that classifier.
- Unknown diagnostic codes and request-ID formats may be omitted by the strict allowlist. This is labeled, rather than silently replaced with a guessed reason.
- Production provider holds remain unresolved. No credentials, account limits, settings, consent, sends, payments, browser state or provider accounts were changed or tested. Publication and subsequent actual-browser acceptance remain separately gated.
