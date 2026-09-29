# Production outreach investigation, 2026-09-29

## Scope

The operator requested one controlled bid-pricing email from production to
brostjared@gmail.com, investigation of absent responses and API spending, and
durable corrections. No other subcontractor messages were authorized by this
test. The recipient must not replace an existing subcontractor's address.

## Direct production observations

- Inbox reported 261 conversations: 204 drafts, 53 waiting on recipients and
  4 needing a reply. The draft examples were Sources Sought responses, not
  evidence of 204 delivered subcontractor bid requests.
- Blue Sage Cuisine replied September 1 that it was interested and would
  prepare a quote. Big Country Technology Services replied August 27.
  Fuerte Fire Protection requested an equipment and maintenance list August 14.
  All were visible under Needs your reply. A fourth item was an out-of-office
  response. These observations establish that some messages and replies worked;
  they do not establish inbox placement for every recipient.
- The Inbox reported 111 outbound attempts over 90 days, 41% with recorded
  delivery or engagement evidence, 4% answered, and no recorded bounces.
  Unconfirmed messages are not automatically failed messages. Absence of a
  bounce is not proof of inbox delivery. The UI also showed 100 unmatched items.
- The recent outreach activity examples were held before Gmail because of
  unverified bid-document links or missing project location. Historical runner
  summaries labeled successful handling of these holds as SUCCESS, although
  no email had been sent.
- At inspection, today's reported estimated spend was $42.73681, of which
  $42.558332 came from 569 OpenAI solicitation-analysis requests. These are
  analysis calls, not 569 sent emails. Daily allowance was already holding
  further paid work. No spending limit was increased during this investigation.
- Monthly used-or-held allowance was $793.47 and the UI reported 34 unconfirmed
  or unfinished reservations. This is not a final provider invoice.

## Corrections

- The template test accepts one validated destination and optionally the
  selected real opportunity/subcontractor/trade context. Real packets use the
  ordinary attachment assembly, package validation, field resolution and
  outbound-content validation. Test sends use the verified account Gmail
  transport. They do not change contact records or schedule follow-ups.
- Sample tests explicitly disclose sample data and no attached bid documents.
  Real tests are clearly identified as controlled copies with no quote or
  commitment requested. The UI reports provider acceptance with a receipt,
  not inbox delivery. Test sends have an account-scoped in-process rate limit.
- All outreach transport callers now receive an error when Gmail returns no
  message receipt. The error instructs the operator to inspect Sent before
  retrying because acceptance can be uncertain.
- Production's real-context selector offered a pairing that the detail endpoint
  returned as Not found. Its list query now enforces matching account ownership
  and excludes removed pairs. Trade selection is preserved and the preview
  excludes superseded/excluded documents. A real PostgreSQL-compatible test
  verifies that foreign-account and removed pairings cannot be offered.
- The runner records a result requiring human action as a warning/skipped
  result instead of a successful activity entry, without repeatedly retrying
  the same held work.
- Before buying document analysis for an initial opportunity, scoring checks
  existing structured company exclusions: ineligible set-aside, inadequate
  lead time, or known value below configured thresholds. These findings create
  a visible review hold without archiving the opportunity. Unknown values,
  active pursuits and lifecycle-preserving recovery remain eligible. Analysis
  recovery respects these flags; rescore clears them when the rule no longer
  applies. Document completeness and pricing safety checks remain in force.
- Sources Sought redelivery keeps an existing draft/response instead of buying
  another AI draft and replacing its PDF. This existence check is not a claim
  of transactional exactly-once execution for simultaneous workers.

## Verification and remaining evidence

The complete offline suite passed 4,793 tests, skipped 738 database/environment
tests, and failed two pre-existing tests. Both failures reproduced on unchanged
main: automation-report-scale's retry-count expectation and solicitation-import's
date extraction expectation. The new controlled-recipient, packet, spending,
receipt and runner tests passed. Typecheck and the production build passed.
The build required an increased Node heap, consistent with the deployment's
existing build configuration.

Deployment and the authorized production send must be verified separately.
Provider acceptance alone cannot determine Gmail Inbox versus Spam. Recipient
placement and actual message authentication results require the received
message. No statement that every recipient receives mail in the inbox is
supported by these observations. Old incomplete bid packets still need their
actual missing source documents or location data repaired before release.
