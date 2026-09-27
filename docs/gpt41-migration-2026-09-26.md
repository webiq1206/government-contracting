# GPT-4.1 migration

Both AI tiers default to OpenAI GPT-4.1. Their complexity flags remain distinct for budget controls. Automatic cross-provider fallback is disabled by default, including initial routing when the selected provider has no key. Explicit provider self-tests and operator overrides remain supported.

## Release configuration

Set both OPENAI_MODEL and OPENAI_MODEL_SMART to gpt-4.1, both AI_ROUTINE_PROVIDER and AI_COMPLEX_PROVIDER to openai, and AI_FALLBACK to false. Existing environment overrides take precedence over code defaults. Keep the existing OpenAI secret private. GPT-4.1 requests omit reasoning parameters.

Apply migration 124 through the normal owner-authorized release migration process before starting the new runtime. It adds official GPT-4.1 token rates without overwriting custom rates and restores the shared OpenAI token-estimation function. The conservative per-request reservation is $3, not a charge or an increased account allowance. Existing account limits remain enforced.

## Safeguards

* Strict structured outputs for quote extraction and independent source review, with local validation.
* Refused, incomplete and truncated outputs cannot be accepted as complete results, even if their partial JSON parses.
* Quote amounts and components must match source-stated currency amounts. Cents are preserved. Computed totals and price-range midpoints are not inferred from email prose; unresolved prices go to review. Existing pricing code continues computing bid totals.
* Malformed compliance rows reject the extraction instead of disappearing from the matrix. Unknown signature flags use the conservative requirement.
* Required-item quotations are checked against their cited document and page, or the notice description when explicitly sourced there.
* A separate GPT-4.1 source-to-brief review checks amendments, deadlines, missing requirements and unsupported assertions. Findings enter the completeness checklist and block workflow progression and bid approval. Failed verification does not produce a passed result.
* Approval rechecks verification findings inside its transaction; force does not bypass them. An audit still in progress blocks approval and readiness.

## Limits

This improves error detection, not a guarantee of perfect extraction. A second model pass can share the first pass's mistakes. Document inventory, unreadable/partial document holds, existing independent package audits and human approval still apply. Existing analyses must be re-run to receive the new source review. The change does not automatically resubmit bids, send outreach, or reanalyze all customers' documents.

Before production acceptance, validate representative text and scanned solicitations through the actual application path, including out-of-order amendments, missing files, quoted price ranges, contradictory deadlines and provider failures. Local mocks do not demonstrate live model accuracy. Preserve deployment and migration evidence separately from code-test results.

Official references: https://developers.openai.com/api/docs/models/gpt-4.1 and https://developers.openai.com/api/docs/guides/structured-outputs
