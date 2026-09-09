# Admin experience audit: verification ledger

Status: in progress. PR #128 is not a complete production audit sign-off.

## Changes on the audit branch

- One navigation map drives the sidebar, mobile destinations, More, and Settings. Current destinations remain discoverable, and subscribed account pages use the same shell.
- Navigation renders before slower status queries finish. Request-local sharing avoids repeating shell queries. An arriving status update preserves menu state and focus.
- Spending protection uses a prominent monthly budget, automatic model selection, and collapsed advanced controls. Unknown costs remain distinguishable from confirmed zero costs.
- A missing company profile has a setup form. Owners can save it, preserve edits after a failed save, and cancel accidental navigation. Read-only roles cannot edit the form or operate automation pause controls.
- Authentication actions have bounded waits and duplicate-submission guards. Successful sign-in/sign-out starts a fresh authenticated document. Protected API requests without a session return JSON 401 rather than HTML login content.
- Quick-view drawers have responsive roles, Escape handling, and focus management. Confirmation dialogs render above the menu.
- Menu background isolation now uses React-managed state with a stable server hydration snapshot. It no longer adds attributes directly to a streamed bottom navigation tree.
- Parent breadcrumb links work even when they are the only breadcrumb. Public footer navigation points to an existing workflow section. Email-template instructions are expandable so the editor is easier to reach on mobile.

## Evidence and limits

The disposable PostgreSQL/Chromium workflow uses synthetic owner and viewer accounts. It has no production integration credentials and does not start workers. External browser requests are blocked, including Google Fonts; screenshots therefore use available fallback fonts. Browser viewport sizes are 390x844, 820x1180, and 1440x1000. These are emulated sizes, not physical-device keyboard or Safari tests.

[CI run 362](https://github.com/webiq1206/government-contracting/actions/runs/34397678064) passed TypeScript, the full unit suite, production build, exact migrations, and database/tenant-role tests at `35e8998d5f56d9625a2bbf081523533c4afebe73`.

[Browser run 8](https://github.com/webiq1206/government-contracting/actions/runs/34389289608) captured 58 routes at all three sizes (174 renders), with zero document-wide horizontal overflows. Nine renders emitted intermittent React hydration errors. Mobile quick look, profile save/failure recovery/unsaved-navigation protection, and API budget save/pause/resume/read recovery completed. Tablet and desktop quick-look waits failed before those later workflows ran.

The viewer account correctly rendered the unavailable page and its automation mutation received HTTP 403. The old browser test incorrectly required HTTP 404 for a streamed Next.js notFound page; it now checks rendered denial and absence of privileged content while retaining the API authorization assertion.

[Browser run 10](https://github.com/webiq1206/government-contracting/actions/runs/34397678108) retests menu isolation and captures quick-look request/navigation evidence. The run completed 174 route renders and all six tablet owner/viewer/visitor workflows. It still reported 15 intermittent hydration failures and quick-look timeouts on mobile and desktop. Targeted diagnostics are being added to a disposable test build; the audit remains open.

Initial-viewport contact sheets were reviewed for the 58 routes at all three sizes. Captures of long public pages are too reduced in contact sheets to verify all text and controls. Bottom-of-page and tab screenshots exist, but their existence alone is not a completed interaction audit.

## Still required

- Resolve remaining hydration errors and quick-look failures using the latest browser evidence. Do not merge unexplained failures.
- Finish checking tab contents, lower-page controls, search/filter/sort combinations, read-only roles, and recovery workflows on every affected route.
- Verify real production admin/tenant sessions, integration authentication, webhook delivery, queue processing, job retries/idempotency, and actual account blockers. The live browser-control service currently fails before a session can be created (daemon readiness timeout); this does not establish that brostco.com is down.
- Profile production-sized data and network conditions. Synthetic local TTFB is not evidence of a production speed improvement. The admin accounts list still loads all account rows before in-memory filtering/paging and needs a database-side pagination review.
- Verify valid invitation, reset-password, vendor-upload, checkout, and subscription workflows. Invalid-link and signed-out renders are not successful workflow tests.
- Test physical mobile keyboards, Safari, slow networks, large datasets, integration outages, concurrent processes, and interrupted actions. No production purchases or outgoing messages were performed.

## Route capture inventory

The table records captured routes, not completed workflows. Aliases and authentication redirects are explicit.

| Route | Observed mobile destination | Captured sizes | Workflow sign-off |
| --- | --- | --- | --- |
| `/settings/account` | `/settings/account` | Desktop, tablet, mobile | Pending |
| `/settings/billing` | `/settings/billing` | Desktop, tablet, mobile | Pending |
| `/settings/notifications` | `/settings/notifications` | Desktop, tablet, mobile | Pending |
| `/activity` | `/activity` | Desktop, tablet, mobile | Pending |
| `/admin/accounts/[id]` | `/admin/accounts/51b3b49d-c94e-4085-865f-999934d7a2be` | Desktop, tablet, mobile | Pending |
| `/admin/accounts` | `/admin/accounts` | Desktop, tablet, mobile | Pending |
| `/admin/api-usage` | `/admin/api-usage` | Desktop, tablet, mobile | Pending |
| `/admin/audit` | `/admin/audit` | Desktop, tablet, mobile | Pending |
| `/admin/billing` | `/admin/billing` | Desktop, tablet, mobile | Pending |
| `/admin/health` | `/admin/health` | Desktop, tablet, mobile | Pending |
| `/admin/invitations` | `/admin/invitations` | Desktop, tablet, mobile | Pending |
| `/admin` | `/admin/accounts` | Desktop, tablet, mobile | Pending |
| `/admin/recap` | `/admin/recap` | Desktop, tablet, mobile | Pending |
| `/agents` | `/agents` | Desktop, tablet, mobile | Pending |
| `/analytics` | `/analytics` | Desktop, tablet, mobile | Pending |
| `/authority` | `/authority` | Desktop, tablet, mobile | Pending |
| `/automation` | `/agents` | Desktop, tablet, mobile | Pending |
| `/call-queue` | `/call-queue` | Desktop, tablet, mobile | Pending |
| `/communications` | `/communications` | Desktop, tablet, mobile | Pending |
| `/compliance` | `/compliance` | Desktop, tablet, mobile | Pending |
| `/contracts/[id]` | `/contracts/f02e29ad-05c6-4496-8668-b0643fed4837` | Desktop, tablet, mobile | Pending |
| `/contracts` | `/contracts` | Desktop, tablet, mobile | Pending |
| `/email-log` | `/communications` | Desktop, tablet, mobile | Pending |
| `/feedback` | `/feedback` | Desktop, tablet, mobile | Pending |
| `/how-it-works` | `/how-it-works` | Desktop, tablet, mobile | Pending |
| `/more` | `/more` | Desktop, tablet, mobile | Pending |
| `/opportunities` | `/pipeline` | Desktop, tablet, mobile | Pending |
| `/opportunity/[id]` | `/opportunity/1d5fe8f3-aa23-4ff2-b863-a7e68ee4006a` | Desktop, tablet, mobile | Pending |
| `/opportunity/[id]/requirements` | `/opportunity/1d5fe8f3-aa23-4ff2-b863-a7e68ee4006a/requirements` | Desktop, tablet, mobile | Pending |
| `/pipeline` | `/pipeline` | Desktop, tablet, mobile | Pending |
| `/recap` | `/recap` | Desktop, tablet, mobile | Pending |
| `/review` | `/review` | Desktop, tablet, mobile | Pending |
| `/search` | `/search` | Desktop, tablet, mobile | Pending |
| `/settings/api-usage` | `/settings/api-usage` | Desktop, tablet, mobile | Pending |
| `/settings/content` | `/settings/content` | Desktop, tablet, mobile | Pending |
| `/settings/integrations` | `/settings/integrations` | Desktop, tablet, mobile | Pending |
| `/settings` | `/settings/profile` | Desktop, tablet, mobile | Pending |
| `/settings/profile` | `/settings/profile` | Desktop, tablet, mobile | Pending |
| `/settings/recap` | `/settings/recap` | Desktop, tablet, mobile | Pending |
| `/settings/rules` | `/settings/rules` | Desktop, tablet, mobile | Pending |
| `/subs/[id]` | `/subs/0a6b9164-7611-49d2-925e-4a255c5fd201` | Desktop, tablet, mobile | Pending |
| `/subs` | `/subs` | Desktop, tablet, mobile | Pending |
| `/today` | `/today` | Desktop, tablet, mobile | Pending |
| `/workbench` | `/workbench` | Desktop, tablet, mobile | Pending |
| `/compare` | `/compare` | Desktop, tablet, mobile | Pending |
| `/pricing-guide` | `/pricing-guide` | Desktop, tablet, mobile | Pending |
| `/privacy` | `/privacy` | Desktop, tablet, mobile | Pending |
| `/sitemap` | `/sitemap` | Desktop, tablet, mobile | Pending |
| `/terms` | `/terms` | Desktop, tablet, mobile | Pending |
| `/billing/success` | `/login` | Desktop, tablet, mobile | Pending |
| `/forgot-password` | `/forgot-password` | Desktop, tablet, mobile | Pending |
| `/invite` | `/invite` | Desktop, tablet, mobile | Pending |
| `/login` | `/login` | Desktop, tablet, mobile | Pending |
| `/` | `/` | Desktop, tablet, mobile | Pending |
| `/reset-password` | `/reset-password` | Desktop, tablet, mobile | Pending |
| `/setup` | `/login` | Desktop, tablet, mobile | Pending |
| `/signup` | `/signup` | Desktop, tablet, mobile | Pending |
| `/vendor/[token]` | `/vendor/invalid-audit-token` | Desktop, tablet, mobile | Pending |
