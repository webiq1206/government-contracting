# Dashboard audit, September 15, 2026

## Release assessment

The application is not yet verified for unrestricted production marketing. This audit combines authenticated, read-only inspection of the live account, source review, disposable database tests, and the repository's responsive browser workflows. Rendering a route does not establish that every provider integration or every possible action succeeds.

The full route/control inventory is in `docs/interface-inventory.md`. Browser evidence and workflow results are attached to the UI audit runs on PR #141. No customer email, financial transaction, bid submission, destructive administrative operation, or billable agent run was initiated during the live review.

## Findings addressed

| Area | Observed problem | Change | Verification |
| --- | --- | --- | --- |
| Pipeline | The live account rendered 477 opportunity cards at once, and simple views lacked search. | Search title, solicitation number, or agency; page list views by 20 and lanes by 12. Keep totals and every record reachable. Clearing search preserves stage/focus. | Pagination edge cases and complete-record coverage; responsive search/empty-state/recovery workflow. |
| Inbox | Up to 100 unmatched messages and their bodies appeared ahead of the conversations users came to handle. | Collapsed matching section, 10-message increments, expandable bodies, clear error feedback, pending-action guard. | Source review and responsive route capture. Matching mutations were not performed against customer mail. |
| New solicitation | Reading a link could replace manually reviewed fields; a new source could retain the previous source's imported facts. | Preserve entered fields, clear obsolete imported facts when the source changes, disable save during import. | Responsive preview and failure-injection workflow. |
| New solicitation | An unread source URL could be dropped; attachment overflow was silent; a delayed redirect could allow a second create. | Retain and validate the URL, report rejected attachments, lock a successfully created record and provide an explicit link. | Typecheck, existing import domain/API tests, responsive save-failure recovery. Successful external extraction still requires configured providers. |
| Automation recovery | A spending blocker linked to general automation health instead of its repair destination. | Use the incident's repair link, with explicit spending-limit wording. | Source review; budgets and execution gates unchanged. |
| Connected apps | A failed initial load required a page reload. | In-place retry with loading and error feedback. | Responsive injected-503 and retry workflow. |
| Review | Expired reviews displayed “Decide in overdue.” | Display “Review overdue.” | Render/source check. |
| Subcontractor conversations | Read-only users could be offered draft/send controls that the API rejects. | Align the composer with the outreach capability and explain access. Announce success/error feedback. | Existing server permission tests and source review. |
| Subcontractor conversations | Complete history repeated the thread content on desktop. | Collapse full history at every viewport; keep current conversations first. | Source review and responsive route capture. |
| Subcontractor conversations | The query selected the oldest 500 emails, hiding newer replies on busy records. | Select the newest 500, then display them chronologically, scoped to tenant and subcontractor. | Real PostgreSQL-compatible test with 510 messages and another tenant's message. |
| Analytics | Live Analytics repeatedly failed with reference 295771609. A reporting query scanned the same history per run. | Replace correlated history scans with window calculations. Preserve strict timestamp ordering, date scope, and tenant isolation. | Same 10,000-run fixture: original 20,581 ms; revised 29 ms; identical counts. Regression tests cover ties and date filters. Live recovery remains unverified until deployment. |
| Settings navigation | Existing automated tests assumed all desktop chips were visible on phones and that Integrations opened on Core. | Exercise the mobile picker and explicitly select Core before testing credentials. | Responsive workflow tests retained; no permission checks removed. |

## Areas inspected

| Area | Live review | Additional disposable coverage |
| --- | --- | --- |
| Today, workbench, calls, review | Queue hierarchy, blocked state, next action, navigation, quick look | Filters, keyboard, history, failure recovery, drawer layout |
| Opportunities, new solicitation, opportunity detail | List, search controls, all seven record tabs, requirement guidance, pricing, documents, submission empty state, activity | Import failure recovery; quick views in all pipeline modes; route/overflow checks |
| Subcontractors and detail | Directory, all eight record tabs, contact/capability, quotes, compliance, notes, activity | Contact edit validation/recovery, quick look, history query regression |
| Inbox, activity, search, recap | Navigation, density, unmatched triage, filters, summaries | Draft delivery status, search/history/back, offline recovery, custom recap settings |
| Contracts and compliance | Empty states, actions, navigation | Contract creation recovery, milestones, issues, modifications, dynamic record capture |
| Settings | Company/NAICS, scoring/history/approvals, rules, integrations, AI budget/usage, content, account, recap, notifications, billing | Unsaved guards, provider error handling, budget controls, template permissions, rules and recap persistence |
| Administration | Accounts and detail tabs, billing, health, usage, audit, invitations, recap | Member-role failure recovery, ownership-transfer cancellation, billing search/pagination, denied privileged operations |
| Authority, feedback, help, workspace directory | Empty/disconnected states and links | Route capture and permissions |
| Alias routes | Opportunities, settings, email-log redirects | Browser navigation and route capture |

## Remaining release blockers and limits

1. Replit's workspace stops at security verification. The publish-status API reports an existing successful deployment but exposes no source revision. GitHub changes must be synced, published, and smoke-tested before describing them as live. No Replit Agent prompts were used.
2. Analytics must be checked on the production dataset after the reporting optimization is deployed. Its error digest alone does not prove the failing query, and server logs were unavailable.
3. Live automation is stopped by spending controls. Those controls were preserved. Provider-backed extraction, generation, discovery, sending, and downstream automation cannot be certified by local success or mocked failures.
4. Several connected-app providers are unavailable until configured. Successful OAuth, refresh, file/calendar sync, notification delivery, and disconnect behavior require authorized test accounts and service configuration.
5. Browser workflows cover concrete tasks and failure paths, not every combinatorial state. Desktop/tablet/mobile CI results must be green for the release revision; screenshots should accompany the release review. Test failures must not be waived as proof of readiness.
