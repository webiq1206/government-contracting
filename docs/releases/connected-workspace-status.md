# Connected workspace continuation

Current source is tracked in [PR #137](https://github.com/webiq1206/government-contracting/pull/137), on `implementation/connected-workflows`. Source changes are authored directly in Git. Replit Agent prompts are not part of this workflow.

## Implemented continuation

The previously authored source transfer is applied to the application. Today shows one next task and up to three upcoming tasks, with complete task views behind a disclosure. Existing filters, actions and deep links remain reachable. Search uses the existing SVG icon system, Settings uses the same selector on every viewport, and account controls are separate from Workspace destinations.

Primary navigation now contains Today, Opportunities, Contracts, Subcontractors and Inbox. Contracts uses five record sections: Overview, Obligations, Documents, Financials and Activity. The full-page record and selected record workspace share the same controls. Older milestone, modification, invoice, issue and coordination links reveal their containing tabs.

Modification entry now requires a review before saving. The review presents exact monetary cents, dates, document name, source note and any superseded modification. Canceling review does not write. Failed saves retain entries and show a nearby error. Both source fields remain visible on the saved record. Drafts survive tab changes; opening another editor or leaving the selected contract is guarded. Existing contract write permissions and transaction logic are unchanged.

Contract questions use facts from the authorized contract record and link to its sections. Missing tenant context, unavailable records and malformed record paths fail closed. The answer is read-only, user-initiated and subject to the existing AI usage controls. It does not claim to have read source-file contents or checked automation status. Source text is explicitly treated as untrusted data in the model instructions.

Desktop detail panels fit the remaining viewport and scroll internally. Today places Quick look beside its content, replacing the optional summary rail while open. Horizontal clipping no longer creates a second vertical document scroller that breaks sticky panels. Touch usage filters retain a 44px minimum height.

## Requirement disposition

The saved [master brief](../redesign/master-brief.md) and [feature preservation decisions](../redesign/feature-preservation.md) distinguish improvements to existing workflows from larger product candidates. The missing full conversation transcript is not used to discard requested work or invent an unapproved module.

| Requested area | Concrete implementation | Verification anchor and limit |
| --- | --- | --- |
| Focused main destinations | `lib/navigation.ts`, focused Today and shared shell | Navigation map, focused-workspace tests and responsive menu/task journeys |
| Contextual contract workspace | `components/contract-detail.tsx`, `components/contract-record.tsx` | Five tabs, preserved record controls, deep links, draft preservation and same-path record navigation in the extended browser audit |
| Connected lifecycle records | Contract overview links opportunity and primary/backup subcontractors; Documents links opportunity files | Rendered links and existing scoped record readers; no new relationship model |
| Reviewed changes and evidence | Modification preview, exact cents, independent document/source notes, existing supersession history | Browser cancel/failure/save assertions; contract money and database record tests |
| Reusable knowledge | Existing `components/content-library-manager.tsx` and `lib/ai/contentLibrary.ts` | Curated snippets feed proposals and Sources Sought drafts through existing account-scoped retrieval; content management and role checks retained |
| Source-grounded AI | Existing opportunity questions plus `lib/domain/contract-guide.ts` and `lib/guide/load.ts` for contracts | Contract fact, missing-data and account-isolation tests; actual fixture facts endpoint and intercepted AI answer in the browser; no paid provider request in QA |
| Requirement-to-response coverage | Existing `components/bid-requirements.tsx`, requirement editor/state controls and source-document/page links | Requirement-state, citation, workspace and PostgreSQL state tests; no claim of new collaborative proposal editing |
| Transparent pricing and coverage | Existing `components/pricing-workspace.tsx`, `lib/domain/pricing-row.ts` | Pricing-row/domain/database tests retain missing-versus-zero, provenance, confidence, alternates and incomplete-total behavior |
| Saved personal/team views | Existing `lib/saved-views.ts` and views controls | Saved-view PostgreSQL tests retain account/person visibility and deletion authority; no duplicate persistence system |
| Reusable review procedures | Existing requirement gates, reusable content and template draft/publish/history controls | Template drafts/versioning and requirement-state tests; a generalized configurable review-gate module remains a product candidate identified in the saved brief |
| Public homepage and media | AI-led messaging, real signup/free-trial actions, hero/gallery media and accessible fallback behavior | Existing public responsive/media scenarios; guided screen previews remain described accurately as previews |

A new pricing workbook engine, generalized custom review gates, full document revision comparison, and custom-report builder are not implemented or represented as completed. Their disposition is recorded in the saved feature-preservation decisions. Field performance and representative-user task-time targets also require real follow-up evidence.

## Verification checkpoints

Baseline `01e1acd61314d1b548f4d762cf39e48a268e94a4` passed [GitHub CI](https://github.com/webiq1206/government-contracting/actions/runs/34731724813), including production build and 798 PostgreSQL integration tests with no failures or skips. Database counts overlap the broader suite and must not be added to it.

The baseline [responsive audit](https://github.com/webiq1206/government-contracting/actions/runs/34731724769) passed desktop, tablet and mobile with zero flagged review items. Targeted checks additionally passed at 360x640, 390x844, 768x1024, 820x1180, 1024x768, 1440x1000 and 1920x1080. Screenshots were inspected. These are baseline results, not substitutes for checking the new contract code.

The contract continuation has passed 54 focused tests across contract money, scoped record loading, contract guidance, guide questions/controls and navigation. Current branch checks and browser results must be green before merge. The extended browser scenario exercises review without a write, invalid precision, dirty drafts across tabs, failed-save recovery, real disposable-record persistence, source display, financial totals, legacy deep links and contract-specific AI sources. External sends, calls, payments and paid AI are not used.

The final local production build passed. The contract browser scenario passed at 360x640, 390x844, 820x1180 and 1440x1000 with no page errors or page-wide horizontal overflow. All five tabs were captured; phone Overview and modification-review screenshots were visually inspected. Contract fields now expose explicit accessible names with separately associated help text. These local results supplement the required full CI and responsive audit on the published branch commit.

## Replit reconciliation and release

The last available read-only Replit inspection reported a clean tree at `24bb077f91fc45a53210b4325b79282149362c57` on `fix/mobile-scroll-homepage`, with local commits ahead of its remote. Its dependency/lockfile and closed-work test changes must be preserved. Replit main was `b36be34a0a27875055ed58510792bd9d93ac6aed`. An earlier successful deployment does not establish that it contains this continuation.

Browser access stopped at Replit's security-verification screen after one reload. No challenge bypass or Replit Agent fallback is authorized. No new production publish has started.

The remaining release sequence is: verify final GitHub CI and responsive evidence, merge validated source to main, reconcile and synchronize Replit without discarding local commits, verify the synchronized source revision, then republish and perform read-only production smoke checks. Current source, merge state, Replit synchronization and published revision must be reported separately.
