# Feature preservation and competitive decisions

This is an implementation disposition, not a claim that every live integration was exercised. No existing feature was intentionally retired. Shared visual changes reach retained workflows; deeper changes are called out below. Role definitions, API authorization, tenant scoping, provider credentials, approval rules, budget enforcement, and duplicate protection remain in their original layers.

## Preserved capabilities

| Capability and location | Inputs and outputs retained | Roles / safeguards retained | Redesign disposition and evidence |
| --- | --- | --- | --- |
| Discovery and fit: Pipeline, opportunity | Company profile and opportunities to ranked records, fit, source and deadline | Existing intake/scoring rules and organization scope | Shared collection refresh; clearer record next step. Domain tests and fixture render. |
| Qualification: Review, opportunity | Recommendation and facts to pursue/pass decision | Existing decision authority, reasons and downstream job behavior | Wider active pane; one main decision panel; deeper readiness expandable. Decision tests retained. |
| Requirements: opportunity requirements | Source documents and selected requirement to checklist/review state | Exact source association, missing-document states and edit rights | Shared responsive editor; hash navigation reveals hidden containing sections. Disclosure regression added. |
| Subcontractors: Subs and record | Contacts, trades, qualifications and availability to relationship history | Tenant scope, merge/dedupe and communication eligibility | Roster/record controls retained under new type, surface, table and mobile rules. |
| Outreach and follow-ups: opportunity, Inbox | Approved content and contacts to drafts, sends, replies and follow-up work | Sending authority, suppression, duplication checks and audit trail | Existing workflow retained; context panes and navigation simplified. No real messages sent in QA. |
| Calls: Calls, My Work, Today | Purpose/script/history to call outcomes and next tasks | Calling-off behavior, outcome rules and safe skip | Full mobile workspace; global tabs removed while open; desktop behavior retained. Call tests preserved. |
| Inbox reconciliation: Inbox | Messages to linked records, draft/reply status and delivery evidence | Scope, matching, supported delivery channels | Plain destination label and focused shared shell; existing message controls retained. |
| Quotes/pricing: opportunity | Quotes, estimates and assumptions to pricing rows and margin | Provenance, pricing math and approval checks | Remain local record sections; advanced information opens on demand. No new workbook engine. |
| Bid preparation/submission: opportunity | Requirements/content/pricing to partial/full packages and readiness | Signature, attestation, review and final submission gates | Consolidated readiness and clearer next step; documents use new palette. Final submission remains the user's action. |
| Contracts and compliance | Award and source material to obligations, documents, renewals and limits | Existing deadline and compliance semantics | Contracts is a primary destination. Records have Overview, Obligations, Documents, Financials and Activity tabs; existing milestone, modification, invoice, issue and coordination controls remain. Modification review displays both stated sources and exact cents before saving. |
| Automation and recovery: Automation | Jobs and provider state to status, incidents, recovery and outputs | Durable jobs, retries, limits, permissions and side-effect controls | Clearer label; schedules remain disclosed; root-cause notices less repetitive on Today. Recovery code unchanged. |
| Activity and recaps | Events/messages/output to searchable history, daily and weekly summaries | Scoped exports, audit records, timezone and delivery settings | Server-preloaded initial activity; compact filters retained; email shell refreshed. No audit data deleted. |
| Reports | Recorded pipeline, revenue and outcomes to charts and drilldowns | Existing definitions, unknown-versus-zero and attribution rules | Formula explanation consolidated into a disclosure; metrics and drilldowns retained. |
| Company knowledge and rules | Profile, content, templates and parameters to reusable governed inputs | Existing approvals, validation and edit capabilities | Shared forms; mobile settings selection; conditional persistent profile save. |
| Billing and API usage | Subscription and provider ledger to limits, charges, invoices and reconciliation | Tenant/platform key ownership, charge acceptance, 1.25x eligible platform usage, dedupe and budgets | Clear AI usage labels, existing plan catalog, unchanged financial math. Billing/usage suites remain. |
| Tenant/admin controls | Account, member, invitation and support inputs to scoped management actions | Admin checks, impersonation restrictions, key grants and destructive guards | Separate admin group, compact shell/tables; original workflows retained. |
| Authentication and account | Credentials/invites/profile to sessions, password reset and account changes | Existing auth, return path and legal terms | Login/signup simplified; other forms inherit system. No new authentication provider. |
| Authority and feedback | Marketing drafts/feedback to existing approval and status workflows | Admin-only authority; existing feedback privacy | Retained destinations, separate optional admin group, shared controls. |

Source anchors include `lib/domain`, `lib/agents`, `lib/requirement-states.ts`, `lib/recovery.ts`, `lib/api-usage`, `lib/billing`, `lib/integration-keys.ts`, and the existing API routes. This branch changes no schema file.

## Competitive gap decisions

These decisions apply the research recorded in [master-brief.md](master-brief.md). They do not assert access to every authenticated GovDash feature or claim exclusive BrostCo functionality.

| Candidate | Existing BrostCo evidence | Benefit and dependencies | Decision |
| --- | --- | --- | --- |
| Saved personal/shared views | Existing views API, account scope and client view controls | Faster return to repeated work; low UI complexity, sharing needs existing permission model | Preserve existing persistence and filters. No second view system or invented sharing capability. |
| Contextual AI with sources | Guide, sources, requirements and existing agent outputs | Less context switching; genuine chat requires grounding, job context and permissions | User-initiated read-only questions use authorized opportunity or contract facts and link to supporting record sections. Contract lookup fails closed on missing account context or unavailable records. Answers explicitly do not claim to have read source-file contents. No general autonomous copilot is claimed. |
| Connected lifecycle | Same opportunity links qualification, subs, calls, pricing, documents and history | Fewer navigation steps without new domain architecture | Improve record/queue organization and next action; retain linked record flow. |
| Reusable knowledge | Company content, documents and templates | Reuse approved inputs; low UI, substantial governance if generalized | Retain existing content workspace; no redundant knowledge library. |
| Proposal outline/section review | Requirements editor and bid preparation/review | Clear completeness and evidence; richer section collaboration needs data model support | Consolidate readiness; keep current editor. No claim of new collaborative proposal editing. |
| Revision comparison | Existing document and template history varies by output | Safer review; requires true stored revisions and diff semantics | Preserve available history. Full document comparison is an unimplemented product candidate. |
| Durable jobs/notifications | Existing job, incident, recovery and notification infrastructure | Trust in long-running work; depends on provider and worker health | Improve visibility, preserve recovery and limits. Do not imply unsupported notification channels. |
| Pricing workbooks, configurable review gates, custom reports | Existing pricing rows, requirements gates and reports | Potential power-user value; medium/high product and verification scope | Preserve current capabilities; larger modules remain candidates, not invented parity features. |

The additions organize existing workflows: server-preloaded activity, disclosure-aware deep links, focused navigation, a connected public product gallery, contract record tabs, modification review, protected drafts, and record-specific AI questions. Existing reusable knowledge, requirement coverage, pricing, saved views, and template review systems remain authoritative. See [connected-workspace-status.md](../releases/connected-workspace-status.md) for the requirement-to-source mapping and current release evidence.
