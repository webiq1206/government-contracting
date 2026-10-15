# Bounded synthetic model screen

Status: runner core implemented and tested offline; **no live runtime binding,
paid execution, production write, import, publication or model activation**.
This is a model-only text screen. It uses the three committed synthetic sources
with deliberately smaller response schemas; it does not execute or certify the
production extraction/normalization, orchestration or PDF paths.

## Exact implementation and execution boundary

- `scripts/lib/synthetic-evaluation.ts` fixes the three sources and schemas,
  Luna/none extraction and Sol/none review, at most five dispatches, 1,600/3,200
  extraction output caps and a 4,096 review cap. It reuses the existing pure
  OpenAI body builder and response parser, with no database/configuration/client
  credential lookup. It accepts a separately reviewed, already configured
  single-dispatch client; no live implementation of that interface is supplied.
- The authorization binds a run ID, exact plan SHA256, exact calculated provider
  cap, runtime/account references and offline/live mode. Wire bodies are deeply
  frozen. A runtime/account change stops before the next dispatch.
- A permanent exclusive local run directory prevents concurrent or later reuse
  of that run ID. It is never cleared or resumed automatically. A private JSONL
  journal fsyncs the run and each dispatch claim before calling the client. A
  crash or uncertain outcome preserves the claim and its unresolved cost bound.
- Known provider cost and unknown-cost holds are separate integer nano-dollar
  fields. No application $3 reservation or tenant markup is used. Any unknown
  usage/model/tier/cache/reasoning/envelope, refusal, ambiguous transport outcome,
  admission failure or semantic-label failure stops the run. A cost-known
  malformed/truncated extraction may receive exactly one correction. No network
  retry, alternate provider, tool, PDF, recovery probe or token-count call exists.
- `scripts/gpt6-synthetic-evaluation.ts --plan` is offline. Any execute flag
  exits with an error before provider access. It reads no environment secret.

The trusted client must perform account admission without provider probes or
production writes and issue one request with no hidden retries. The interface
does not enforce arbitrary third-party code internally, grant permission to
bypass existing holds, or establish that such a client currently exists. A
future live binding must be reviewed separately; a positive authorization
object by itself does not make an unsafe binding acceptable.

## Actual provider cost versus internal holds

The full serialized request plus a 4,096-token framing allowance must fit within
8,192 tokens for every fixed attempt. No input is truncated. The allowance is a
conservative qualification assumption and will be checked against observed
usage; it is not a provider-side dollar spending cap.

| Attempt | Model | Max input | Max output | Standard provider ceiling |
| --- | --- | ---: | ---: | ---: |
| Exact cents | gpt-6-luna | 8,192 | 1,600 | $0.0016192 |
| Optional cents correction | gpt-6-luna | 8,192 | 3,200 | $0.0024192 |
| Ambiguous range | gpt-6-luna | 8,192 | 1,600 | $0.0016192 |
| Optional range correction | gpt-6-luna | 8,192 | 3,200 | $0.0024192 |
| Amendment reconciliation | gpt-6-sol | 8,192 | 4,096 | $0.0573440 |
| Total, including both corrections | | | | **$0.0654208** |

Official standard rates: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
$0.10/M input and $0.50/M output; [Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)
$2/M input and $10/M output. Reasoning is none, caching explicit with no
breakpoints, standard service, no regional premium or long context. Any
different billing contract requires a new reviewed plan before execution.

The earlier $15/$18.75 figures were internal application reservation envelopes,
not provider charges. The 25% figure comes from BrostCo's own ledger, only for
platform credentials with accepted tenant billing. `requestIdentity` explicitly
sets that acceptance false for `LEGACY_ORG_ID`; the founding-account evaluation
must not be assigned that tenant markup. This is verified source behavior, not
a claim about an observed invoice.

[Replit AI billing](https://docs.replit.com/billing/ai-billing) states that its
Agent services use the provider's public API rate. That does not prove BrostCo
uses Replit's AI proxy: the inspected app adapter posts to
`https://api.openai.com/v1/responses`; it has no AI_INTEGRATIONS_OPENAI binding.
No new proxy, provider or credential is proposed. Existing hosting costs and
any account-specific charges are not established by this token calculation.

No spending approval is requested yet. Once a compliant live binding and exact
account pricing are verified, the proposed one-run provider allowance can be
the fixed **$0.0654208**, commonly described as **less than $0.07**. It includes
all permitted retries/corrections; unused allowance cannot buy more attempts.

## Can the existing Replit app supply a safe one-shot process?

Target remains the existing app `2fcd16f4-edbe-4d58-b3aa-0988df8c05d5`; no new app,
account or persistent access is needed merely to host a process. However, its
existing application client cannot currently satisfy the specified execution
boundary:

1. `orgApiKey` resolves settings/environment through normal application code.
   The agent need not see or copy a credential, but a child process is not known
   to have the exact effective credential solely from environment inheritance;
   saved encrypted settings can take precedence. No values were inspected.
2. `runRoute` invokes `withProviderFacts` and the metered ledger. These create
   pending-attempt/usage records and later update provider facts. Reusing that
   client makes production database writes even for a harmless synthetic prompt.
3. Calling `openAiResponse` directly would omit current shared provider holds,
   admission, concurrent-attempt coordination and usage accounting. A new local
   ledger only fences this evaluation; it cannot replace those shared controls.
   A read-only readiness snapshot also cannot reserve account-wide capacity.
4. Retained authenticated evidence included an OpenAI refusal. Its current
   status is not re-proved here. This runner is not a recovery probe and cannot
   clear or silently disregard that record.

Therefore **an existing-app one-shot execution is technically possible but not
currently approved/safe under the simultaneous no-production-write and
preserve-shared-admission constraints**. Do not switch to an inherited env key,
empty database, new proxy or another account to make it appear isolated.
No live adapter was added to bypass this conflict.

The next engineering decision is a reviewed admission mechanism compatible with
both constraints, or an explicit narrowly scoped change to that execution
boundary. It is not a request for the owner to choose ordinary infrastructure or
approve $18.75. Only after that is resolved should the coordinator present a
single actual-cost-bound execution approval.

## Validation and limitations

Focused tests exercise cost arithmetic, fixed no-tool request bodies, three- and
five-dispatch paths, durable pre-I/O claims, competing/repeated run rejection,
unknown/malformed usage, unexpected models/tiers/cache/reasoning/token counts,
refusals, transport errors without secret logging, semantic failures, source
citations, correction exhaustion, runtime drift, authorization mismatch,
unavailable journals, symlink rejection and disabled live CLI behavior.

Tests use synthetic in-process responses and block global fetch. They establish
runner mechanics, not real model quality or credential/account readiness. The
fixed reduced schemas are intentionally narrower than production application
schemas. Full extraction/normalization, PDFs, citations across real pages and
deployment acceptance remain separate. Candidate activation stays disabled.
