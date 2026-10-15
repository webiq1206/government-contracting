# Bounded GPT-6 candidate migration — 2026-10-14

Status: **offline preparation; not a production model selection or release**.
No paid inference, production SQL, provider recovery, replay, sends, account
changes or publication were performed for this change.

## Candidate selection

| Workload | Candidate | Effort | Standard input / output per 1M tokens |
| --- | --- | --- | --- |
| Routine extraction, scoring and summaries | `gpt-6-luna` | `none` | $0.10 / $0.50 |
| Complex document-source reconciliation | `gpt-6-sol` | `none` | $2 / $10 |

This is a task-fit hypothesis, not measured BrostCo quality. The official
[Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna) describes
focused high-volume work; [Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)
supports complex work with reasoning disabled. Sol output is 25% more expensive
than GPT-4.1's $8/M; keeping a token limit is not budget neutrality. GPT-6.1 Sol
does not support `none`, so it is not used as a parameter-compatible replacement.
See [GPT-6 migration guidance](https://developers.openai.com/api/docs/guides/latest-model).

`OPENAI_GPT6_CANDIDATES` defaults to false. Existing effective defaults and the
founding-account GPT-4.1 compatibility path remain until qualification. When
explicitly enabled, defaults become Luna routine and Sol complex; explicit
`OPENAI_MODEL` / `OPENAI_MODEL_SMART` overrides still win. Founding routing then
uses those configured tiers, including explicit legacy tier callers. No setting
is changed by this PR. `.env.example` deliberately keeps its GPT-4.1 overrides.

Both exact candidate IDs use `reasoning.effort=none`, unchanged caller output
caps, no reasoning headroom, `store=false`, `service_tier=default`, and disabled
truncation. The adapter does not apply legacy medium/+4096 knobs to candidates.
Direct requests for other GPT-6 IDs or non-none effort are rejected. The old
GPT-5/o-series behavior remains available under its existing configuration.

## Cost and unknown usage

[Prompt-cache documentation](https://developers.openai.com/api/docs/guides/prompt-caching)
describes cache writes as separately priced. Candidate requests use explicit
mode without any breakpoints, so neither reads nor writes are requested. Rate
rows still record all four documented buckets. GPT-6 requests are limited to
text bounded at 272,000 input tokens using UTF-8 byte length of the full prompt,
instructions and schema plus a 4,096-token framing allowance. Caller output
limits are validated, never reduced. This offline transport bound must also be
checked against observed usage in qualification.

PDF compressed byte size and page count do not establish processed token cost.
Candidate PDF requests are held locally, without sending or shortening the
document. GPT-4.1's existing PDF path remains unchanged while candidates are off.
Full production activation is blocked until a PDF cost contract is implemented
and validated. OpenAI's [token counting endpoint](https://developers.openai.com/api/docs/guides/token-counting)
supports processed PDF input, but this change does not add another provider call
or assume permission to use it. Long-context pricing above 272K, Fast service,
regional processing and reasoning are outside this contract.

Under the existing admission lock, candidate calls always require complete
prices and a finite shared dollar cap, including connection tests and recovery
probes. Request-count limits cannot substitute. The configured reservation must
cover the entire allowed input/output envelope and the existing 10% ledger
buffer, at prices no lower than the verified standard rates. Custom rates and
ceilings remain unchanged; insufficient rows hold work. The new rows retain
the existing $3 per-request reservation. At documented rates, even allowing
the maximum cache-write input rate, the full envelope plus buffer is $0.1078
for Luna and $2.156 for Sol, within $3.

Missing, invalid or contradictory OpenAI usage remains absent, rather than
becoming zero. Candidate responses with an unexpected service tier, cache use,
reasoning or long-context input also retain unknown cost. A completed answer
is kept; accounting uncertainty does not request another completion. The
ledger retains the reservation and does not invent a provider receipt. JSON
correction totals stay unknown if any attempt lacks usage. Existing provider
holds, receipt identity, one-correction cap and send protections are unchanged.

## Labeled evaluation proposal (not run)

Run the offline plan with:

```sh
node --import tsx scripts/gpt6-evaluation-plan.ts
```

It has no database, credentials or provider client dependency. Cases are the
existing synthetic inputs from `scripts/gpt41-smoke.ts`, with explicit labels
in `tests/fixtures/model-migration-gold.ts`:

1. Source-stated $1,234.56 must retain cents through the AI extraction path.
2. A $10,000–$12,000 range must remain null with clarification required.
3. Out-of-order amendments must flag the stale deadline and omitted signature.

Maximum attempts: five (two extractions with one correction each, one review).
Using the full allowed input envelope on every attempt and output caps
1600/3200, 1600/3200 and 4096, standard provider cost is bounded in the proposal
at **$0.69856**, or **$0.768416** with the ledger's 10% buffer. This is not an
observed bill. Unknown/refused attempts can retain all five $3 reservations:
**$15**, or **$18.75** for accepted platform billing with its existing markup.
No scoped evaluation allowance or isolated execution runtime was verified,
so all quality results are **UNRUN** and actual model spending is **$0**.

Before production selection, obtain a named isolated test organization and a
scoped allowance that covers the full reservation envelope. Verify no production
database credentials, active workers, fallback, sends or account-setting actions
are reachable. Run the real extraction/review paths with those labels, capture
model/effort, exact prompts, results, latency and metered usage. Stop on exhausted
allowance, unknown billing, provider refusal or failed labels. Do not reset a
hold or retry uncertain work. Offline mocks establish contracts, not accuracy.

The three inherited cases are insufficient for release. Add and label clearly
synthetic/public-safe text and scanned PDFs, physical page citations, missing
attachments, conflicting amendments/timezones and unsupported assertions.
Confirm no invented numbers, citations, attachments or provider receipts.
Existing deterministic grounding/readiness tests remain useful regressions,
but are not evidence of either candidate's live quality.

## Separately bounded production pricing plan

Migration `134_gpt6_candidate_rates.sql` inserts at most two rows with
`ON CONFLICT DO NOTHING`. It never modifies migration 124, existing custom
prices, budgets, preferences, credentials, usage events, receipts or fences.
It does not select models. The production operator must separately authorize
and perform this migration through the established protected migration workflow.

Before authorization: verify exact reviewed source/tree and migration hash,
read only the two affected price rows and current schema ledger, preserve their
preimage and the release's approved recovery material, and verify a bounded
workflow plan. If a custom row exists, retain it and assess admission against
it; this migration cannot silently repair it. Expected result is zero, one or
two new rows and zero changed pre-existing rows. Apply once with the normal
transaction and timeout controls, verify the recorded migration checksum and
affected rows, and separately verify unchanged budget/receipt/hold evidence.
Do not combine this operation with model activation or a test call.

No production migration has run. The previously retained recovery package and
its 2026-10-20 expiry are unchanged; it is not a full business-data backup.

## Release gates and rollback

Required before activation: reviewed exact-head CI and disposable-database
checks; labeled live quality evidence; verified text/PDF cost bounds and real
usage fields; approved pricing migration; source/build provenance; worker/fleet
coordination; receipt reconciliation; scoped fresh signed-in desktop/mobile
acceptance. Login and runtime provenance blockers remain separate. PR201 and
the intentional negative-test worktree are excluded from this branch.

Parent owns release. Keep candidate opt-in false and existing model settings
unchanged until those gates pass. If candidate activation is later reversed,
restore the recorded previous model/flag configuration and deployment through
the release workflow. Never reset usage/receipt/provider/preview holds or replay
historical work as a rollback. Preserve the additive price rows and their
history; do not delete them after usage exists. Code rollback alone is not
authorization to resume work.
