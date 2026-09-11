# Release gates and unresolved work

**Status: draft implementation for review. Do not describe the entire master brief as complete.** The code and assets are concrete; the remaining requirements below need current evidence before production release.

## Verified locally

- Full local unit run: 4,469 passed, 735 database-dependent tests skipped, no failures.
- Initial published CI passed, including 798 PostgreSQL integration tests without skips. Desktop browser audit passed; mobile/tablet follow-up rerun remains required.
- A three-page bid with 24 long scope descriptions was visually reviewed. Full text now wraps without truncation; paragraph grouping and page numbers improve continuation. The new content regression plus existing document/email checks passed (26 tests).
- Production build and TypeScript checks passed.
- All 58 discovered page routes exercised by the production HTTP fixture harness. Redirects and token/error states are not counted as complete content workflows.
- Anonymous saved-view access denied; authenticated fixture access allowed.
- Static CSS review across application/public patterns, including 320px mobile opportunity controls and dark mode.
- A portable 48-screen review with device widths and theme controls.
- Seven MP4 assets with measured durations, VTT captions, transcripts, and posters. The 120-second asset decoded and played in the browser at 1280x960, readyState 4, with no media error.

## Open gates

| Gate | Precise remaining work | Why it remains open / closure evidence |
| --- | --- | --- |
| Authenticated browser journeys | Run and inspect existing UI-audit results for desktop, tablet and mobile; repair failures and confirm navigation, forms, dialogs, disclosures, drafts, recovery and roles | The managed live preview served mismatched client bundles from another application. Server rendering was verified independently. Static review does not hydrate BrostCo's client code. CI browser artifacts can close the fixture portion of this gate. |
| Full route/state acceptance | Inspect all meaningful tabs, dialogs, menus, empty/error/slow states and long-content cases; confirm every route-specific requirement in the brief | A shared style change and HTTP 200 are not individual UX acceptance. Coverage ledger distinguishes direct simplifications and inherited presentation. |
| Device/accessibility matrix | Complete 360/390/768/1024/1440/1920 widths, landscape, short screens, keyboard-open behavior, 200% zoom, keyboard navigation, screen reader, focus and contrast audit | Available visual samples and 44px CSS rules do not prove all states or WCAG compliance. Use actual interactive pages and devices. |
| Real workflow videos | Record authentic click-through sequences using sanitized demo data; edit clear desktop/mobile crops; provide main narration and verify all captions/playback states | Current MP4s are guided sequences of captured screens, not action recordings. The storyboard and script are ready; usable players and preview media are implemented. |
| Real PostgreSQL gate | Pass repository CI database workflow on the final branch | Initial published CI passed 798 PostgreSQL tests without skips. Require the same gate on the final follow-up commit. PGlite SSR fixtures alone do not replace this gate. |
| Provider and payment integration | Exercise existing test-mode end-to-end flows for configured services, usage charges and recovery where required by existing release policy | No external sends, real calls, live charges, provider runs or actual submissions were executed in this redesign. |
| Performance | Measure authenticated route budgets, public lab performance and production field metrics after rollout | HTTP fixture durations are not browser performance. No Core Web Vitals or improvement percentage is claimed. |
| Usability and comparison | Run the repository's task-based usability protocol with representative contractors; verify task time, steps, clarity and error recovery | The visual redesign has not been demonstrated to outperform GovDash in a controlled comparison. |
| Before/after evidence | Pair current screenshots with matching-role, matching-data baseline screenshots at the same widths | Historical research screenshots use different fixture/revision combinations. This handoff does not mislabel those as a controlled comparison. |
| Email/document visual QA | Inspect rendered outputs across target clients and representative long bids | A representative three-page bid and its full pricing text were reviewed and tested; every exported or emailed state and target email client is not yet certified. |

## Decisions and implementation limits

The landing page was rebuilt. Core queue, opportunity, settings navigation, activity arrival, and mobile action layers received targeted behavior changes. Many supporting pages keep their existing feature structure while adopting the shared visual system. Any route-specific brief item absent from the implementation is still open; the route ledger is not a blanket completion checkmark.

No feature was deliberately removed. No general-purpose AI chat, collaborative proposal editor, new pricing workbook, custom report builder, or document diff engine was added without a supporting backend. The existing strengths are retained and made more accessible.

The public review file contains synthetic data and disconnected actions. Do not publish raw audit HTML or temporary fixture identifiers. The fixture-render route returns 404 in production.

## Release sequence

1. Inspect the draft PR, review file and coverage ledger.
2. Require passing CI, database and browser jobs on the final commit; inspect screenshots and failures rather than only the job summary.
3. Close the master brief's interaction, device, media, accessibility and measurement gates. Mark any deliberate scope change explicitly instead of implying it shipped.
4. Follow the established BrostCo merge and deployment process. Keep the prior production revision available.
5. Smoke-test public conversion, signup/login, Today, a record action, saved work, activity, role boundaries and usage/billing access.
6. If a regression blocks work, revert the application change and redeploy. This branch introduces no production data migration.
