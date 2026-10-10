# Stored timestamp display review

The live Activity ledger displayed `2026-10-10 19:15:07.014382+00` as
`10/10/2026, 1:15:07 PM` in a Denver browser, without identifying the timezone.
It now renders **Oct 10, 2026, 7:15:07 PM UTC**. The source timestamp and all
write, ordering, date-filter and scheduling behavior remain unchanged.

The existing communication timestamp parser is now the shared
`storedTimestamp` formatter. `communicationTimestamp` remains an alias, so
communication history keeps its existing behavior. `StoredTime` provides the
same explicit UTC label and normalized ISO `datetime` to event components.
Activity, API usage, automation-run details and recovery history retain
seconds. Machine-readable output retains JavaScript millisecond precision;
the original PostgreSQL microsecond string is not rewritten. Ambiguous
strings without an offset and invalid dates show `Time unavailable`.

## Renderer review

| Surface | Result |
| --- | --- |
| Activity ledger and API usage ledger | Shared semantic time element, explicit UTC and seconds. |
| Automation-run details and recovery history | Same formatter and explicit UTC, with seconds. |
| Guide changes, requirement history and verification results | Shared UTC rendering, including a year and honest invalid-time fallback. |
| Receipt card | UTC time; the original recorded timezone is separate metadata, not appended to a clock formatted in a different timezone. |
| Pricing updates, template versions and saved drafts, recap delivery history | Shared saved-instant rendering. |
| Integration checks/use, connected-service sync and webhook delivery | Shared saved-instant rendering. |
| Conversation threads, communication history, supplier activity and unmatched mail | Existing formatter callers share the extracted implementation; no behavioral change. |
| Finished-today list | Retains the chosen account timezone and now labels it. |
| Call-later confirmation and form-save acknowledgements | Retain the operator's local clock and now label it. |
| Deadline countdown, quote/template deadline labels, platform refresh labels | Already identify the intended timezone; reviewed and retained. |

The review searched `components`, `app` and shared domain code for absolute
date/time formatting. Calendar-only dates, date inputs and date-only summaries
were not converted into timestamp displays. Relative age labels were not
changed. No provider, database, consent, security-header or runtime-setting
change is included.

## Verification

- The initial regression failed all six original cases on the released tree,
  reproducing the Denver six-hour discrepancy and the unlabeled receipt time.
- Nine new tests cover the actual Activity renderer, UTC/Denver/Auckland,
  invalid and timezone-less inputs, a daylight-saving fold, a year boundary,
  the reusable renderer, connection text, receipt metadata and UTC-to-Denver
  React hydration. Hydration asserts no fetch, recoverable error or console
  error and checks that the original row timestamp is unchanged.
- Focused suite: 50 passed across five files.
- Full credential-free suite with the external-network guard: 5,377 passed,
  742 skipped across 648 files (556 passed, 92 skipped). Skipped database
  cases are not live or database acceptance evidence.
- TypeScript and production Next build passed. Build includes its normal
  type check. Existing deprecation/test-fixture diagnostics are retained in
  local logs; no claim that all test/build output is warning-free.

This fix is unpublished. Actual Chrome validation, including narrow layouts,
requires the parent's next browser/release handoff. Provider holds and the
cancelled mail transmission are separate and unresolved.
