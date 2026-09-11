# BrostCo Complete Redesign

## Master implementation brief for GPT-6 Astra Max

Prepared September 11, 2026. Apply this entire document to https://brostco.com and its application. This is an implementation assignment, not a request for another high-level plan.

## 1. Your assignment

Act as a senior product designer, UX researcher, conversion copywriter, accessibility specialist, and full-stack engineer. Completely redesign BrostCo's public website and application so users can understand the product, start using it, complete their work, and recover from problems with exceptional clarity.

The goal is fewer steps to complete work, clearer AI activity, easier error recovery, and more usable mobile screens. Retain BrostCo's valuable capabilities and business logic while improving their organization and presentation. Design an original, modern AI platform with a coherent visual identity across marketing, onboarding, daily work, settings, and administration.

Use GovDash's clarity, focused demonstrations, information hierarchy, and connected workflows as references. Make design decisions specific to BrostCo. Do not copy GovDash's branding, assets, text, or interface wholesale. Do not treat its public marketing gallery as proof that every internal screen is equally simple.

The existing colors and styling are open to replacement. Choose the strongest cohesive design for this product. Preserve the BrostCo name and recognizable logo identity unless a logo change is explicitly requested. Update logo presentation and approved monochrome variants as needed for the new palette.

Deliver working implementation, complete coverage, realistic previews, and verification evidence. Do not stop after restyling the homepage or shared shell. Do not call the work perfect based on appearance alone; demonstrate completion against the requirements below.

## 2. Scope and evidence

Cover every public page, landing page, authentication screen, onboarding step, tenant dashboard, personal account screen, settings screen, admin page, navigation menu, tab, drawer, modal, form, table, card, notification, empty state, error state, and workflow. Include user-facing emails, generated documents, and exports where their presentation or links form part of the redesigned journey. Preserve their underlying content and business meaning.

Start by inspecting the current repository, instructions, deployed behavior, route structure, roles, data models, and job lifecycle. Reconcile the deployed version with the checked-out revision. Do not overwrite unrelated work.

Prior research provides a starting point, not a current completion certificate:

- A prior checkout of `webiq1206/government-contracting` matched main at `3de9d15129c392c2faab7817eb2caa2b89dda6d0`. Recheck the current revision.
- That review identified 44 dashboard/account page files: 39 content routes and five redirect entry points. Discover all current routes, including public routes and anything added since that review.
- Thirty-two historical screenshot samples were inspected. They predominantly used synthetic accounts and were not a complete fresh production review.
- Previous live BrostCo browser inspection timed out. GovDash browsing later succeeded. Neither fact establishes the current state of BrostCo.
- GovDash's five homepage tabs were clicked and their visuals inspected. Capture, Pricer, and Contracts animation documents were inspected. Public help documentation was reviewed. A complete authenticated GovDash audit was not performed.

Create a route and interaction inventory before editing. For each entry, record URL, role, purpose, data requirements, tabs/dialogs, primary task, current problems, proposed pattern, preserved capabilities, and verification status. Historical screenshots may inform the baseline but cannot close current visual verification.

If production access is unavailable, use the repository and a functioning local or preview environment with representative fixtures. Continue all work that can be completed, document the exact remaining access gap, and never substitute an error page for successful verification.

## 3. Design principles

Every operational screen must answer immediately: Where am I? What needs attention? What has AI done? What should I do next?

1. Give each screen a clear purpose and visually dominant next action. Distinguish essential information from optional detail.
2. Use plain English, familiar labels, concise explanations, and specific verbs. Replace internal system terminology with language users understand.
3. Show useful work before decorative greetings, broad statistics, setup instructions, and repeated alerts.
4. Reveal advanced controls when relevant. Keep applied filters, changed settings, and hidden active constraints visible.
5. Make common tasks available through buttons and forms. AI assistance should reduce effort without making chat mandatory.
6. Keep users in context. Preserve filters, selected records, scroll position, drafts, and safe return paths.
7. Preserve the same concepts and labels across desktop, tablet, mobile, email, search, and help.
8. Use whitespace to establish grouping while maintaining useful operational density.
9. Give every failure an understandable explanation and an accurate next step. Never display fake success or a generic Fix button that cannot resolve the cause.
10. Preserve depth through organization, contextual actions, and focused editors. Removing valuable functionality is not an acceptable shortcut.

## 4. Feature preservation and competitive gaps

Build a feature preservation matrix before changing each workflow. Include current location, intended behavior, roles, inputs, outputs, integrations, safeguards, new location, and verification evidence. Classify each feature as preserved, improved, consolidated, or proposed for retirement. Consolidation must retain functionality. Retiring a capability requires an explicit decision.

Inventory and preserve opportunity discovery and qualification; requirements and source documents; subcontractor sourcing and relationships; outreach and follow-ups; calling; inbox and message reconciliation; quotes and pricing; partial and complete bid preparation; review and submission controls; contract obligations and compliance; automation schedules, limits, approvals, and recovery; activity history; daily recaps; analytics; account administration; billing; API usage; tenant isolation; and all additional capabilities found in the code.

Distinguish actual implementation from intended product requirements. Do not describe an existing button or unfinished backend as a working feature without verifying it.

Create a competitive gap matrix for these candidates:

| Candidate | Evaluation and decision rule |
| --- | --- |
| Saved personal and shared views | Check current filters and persistence; improve discoverability before adding another view system. |
| Contextual AI with source access | Extend the existing guide where practical; retain permissions and show factual grounding. |
| Connected opportunity lifecycle | Remove repeated entry and lost context across qualification, outreach, pricing, and submission. |
| Reusable company knowledge | Evaluate content, documents, past performance, and templates already available before creating another library. |
| Proposal outline and section review | Evaluate existing requirements and bid preparation; identify missing status, source, or review controls. |
| Document revisions and change review | Determine whether backend version history exists; add genuine comparison and recovery only where supported. |
| Durable AI jobs and notifications | Check current scheduling, history, and retry behavior; close gaps in continuity and user visibility. |
| Pricing workbooks, configurable gate reviews, and custom reports | Treat as scope candidates requiring a proven user need and implementation assessment, not automatic parity work. |

For each candidate, record evidence, whether BrostCo already supports it, user benefit, dependencies, complexity, and recommendation. Implement justified usability improvements and necessary supporting behavior. Keep substantial new product modules distinct from the redesign scope. Do not add features solely because GovDash markets them, or claim BrostCo features are exclusive without evidence.

## 5. Visual direction and design system

Use a calm, precise, contemporary visual system that makes the product feel trustworthy and approachable. Start with these proposed tokens, refine them through rendered review, and apply the final system consistently:

| Element | Starting direction |
| --- | --- |
| Page background | Soft cool neutral, approximately `#F6F8FB` |
| Primary surface | White, approximately `#FFFFFF` |
| Primary text | Deep ink, approximately `#152033` |
| Secondary text | Slate, approximately `#526176` |
| Primary action | Strong blue, approximately `#2457E6` |
| Supporting accent | Restrained teal, approximately `#0F766E` |
| Borders | Quiet neutral, approximately `#DCE3ED` |
| Typography | One high-quality sans-serif family with clear numerals and weights; use efficient font loading. |
| Shape and depth | Consistent moderate radii, subtle borders, limited shadows, clearly separated layers. |

These are design starting points, not prevalidated contrast combinations. Check every final foreground/background pair, hover state, selected state, and disabled state. Use status colors semantically and pair them with text or icons.

Define tokens for color, spacing, type, radii, elevation, motion, breakpoints, and layer order. Use a compact spacing scale based on 4px increments. Target 16px primary body text and form inputs, 14px secondary text, and at least 44px touch targets. Small metadata must remain legible and should not carry the key decision. Remove tiny uppercase operational text and oversized editorial headings from work screens.

Create reusable components for navigation, page headers, toolbars, filters, saved views, cards, lists, tables, quick views, record tabs, editors, AI status, source citations, notices, empty states, errors, confirmations, and loading. Update supported themes consistently. An unfinished alternate theme is not acceptable.

Use restrained animation for orientation and feedback. Honor reduced-motion preferences. Avoid decorative motion, gradients, illustrations, or oversized cards that compete with work.

## 6. Navigation and responsive application shell

Use a single navigation model across device sizes, search, breadcrumbs, redirects, and help. Organize around user work, not implementation modules.

Suggested desktop grouping: Today; My Work with Review and Calls; Opportunities; Relationships with Subcontractors and Inbox; Delivery with Contracts and Compliance; Insights with Activity, Recaps, and Reports. Keep Automation status easy to reach. Place settings and account controls in a predictable utility area. Put platform administration in a distinct workspace with unmistakable account scope.

Validate this grouping against actual roles and task frequency. Preserve direct URLs even when a route becomes a view within a broader workspace. Avoid duplicate navigation structures and inconsistent names such as Bids on one device and Opportunities on another unless they mean different things.

On root mobile screens, use a small set of labeled primary destinations, with More for the remainder. On focused record, editing, or review screens, provide explicit Back and a compact contextual header. Use at most one persistent bottom action layer. Do not stack global tabs, a sticky decision footer, floating AI controls, and other bars over the same working area. Buttons may remain in normal flow when that gives users more space.

Desktop may use a list and detail layout with optional evidence alongside it. Tablet and narrow laptops should collapse secondary context before sacrificing readability. Mobile should show one focused pane at a time, with reliable return to the previous pane. Keep dense tables available when useful, using column selection and contained horizontal scrolling; the page itself must not overflow.

Verify long titles, landscape orientation, safe areas, browser controls, open keyboards, zoom, and short screens. Reserve navigation space once. Avoid nested scroll traps and independently scrolling action footers.

## 7. Core workflow behavior

Design complete journeys before polishing isolated pages:

| Journey | Required experience |
| --- | --- |
| New account to first useful result | Explain setup requirements, connect only necessary services, show honest progress, and reach a useful opportunity or task quickly. Allow optional setup to be deferred. |
| Opportunity to pursue/pass decision | Show fit, deadline, recommendation, uncertainties, and sources; record the decision and explain the resulting state. |
| Pursuit to subcontractor outreach | Retain opportunity context, select suitable contacts, review content as required, track sending and replies, and avoid duplicate outreach. |
| Reply or call to follow-up | Show conversation history and purpose; record the outcome; schedule or skip the next step within applicable rules. |
| Requirements to bid preparation | Connect each requirement to its source, supporting content, missing input, and review state. Preserve partial work. |
| Pricing to submission | Show assumptions, quote provenance, readiness, missing items, and the applicable review gate before consequential actions. |
| Award to delivery | Carry relevant context into contract obligations, documents, deadlines, and compliance work without duplicate entry. |
| Failed automation to recovery | Explain the cause, affected work, and corrective action; preserve queued work; show whether retry is safe and what succeeded. |
| Activity to accountability | Let users trace what happened, who or what acted, the recipient or record, output, outcome, and associated usage. |

Support quick view and contextual quick actions wherever they remove unnecessary navigation. Provide skip, snooze, pause, edit, cancel, and resume where valid. Explain the impact of skipping required work; do not silently mark obligations complete. Preserve existing automation authority and approval rules rather than introducing unnecessary confirmation steps.

## 8. AI, reliability, and error recovery

Build on the current Guide Me, search, and job infrastructure where appropriate. Keep assistance available in context without covering the screen. Offer useful starting actions such as explaining an opportunity, checking missing requirements, drafting a reply, or explaining a delay when those actions are supported.

Distinguish proposed work, queued work, running work, waiting on a user, completed work, partial completion, and failure. Show the last meaningful update and the next required action. Do not fabricate percentages, sources, confidence scores, or completion messages.

Make factual sources accessible beside the result. Distinguish known facts, estimates, missing data, and AI suggestions. Preview consequential changes where current authority requires review. Background jobs must retain their status across navigation and reconnect users with their outputs.

Group repeated failures by root cause while retaining access to affected items. Recovery controls should name the real action: Reconnect email, Update payment, Review missing information, or Retry failed step. If a user cannot resolve the issue, explain who can and provide appropriate diagnostics without exposing secrets. Distinguish a user-fixable connection problem from a provider outage.

Preserve tenant isolation, role checks, duplicate protection, budgets, retry limits, and auditability. Loading states should reveal page structure, retain prior data when safe, show freshness, and prevent duplicate actions. Empty, loading, unavailable, and zero-result states must look and read differently.

## 9. Activity ledger, API usage, and billing

The action ledger must let users answer what the system did, when, why, for whom, and with what result. Provide plain-language rows with record links, actor, event type, timestamp/time zone, outcome, and expandable details. Include supported email sends and replies, outreach, calls, partial and complete bids, generated documents, decisions, and automation runs. Provide search and useful date, type, status, actor, and record filters without showing the full filter form by default.

Show message recipients and content, generated outputs, related events, and failure/recovery history where permissions allow. Group technical events into understandable activity without deleting the underlying audit trail. Exports must respect scope and permissions.

Tenant usage screens must clearly identify whether the customer uses their own API keys or platform-provided usage, what they owe, and their budget/limits. Preserve the established requirement to charge 1.25 times the underlying API cost for platform-provided usage, subject to verification of the authoritative billing implementation. Avoid duplicate charges and do not confuse estimated cost with settled charges. The customer does not need the internal markup formula, but must understand that platform usage is billable.

Admins need per-tenant provider cost, customer charges, key ownership, adjustments, and reconciliation. Never expose API secrets. Keep platform financial controls separate from ordinary tenant navigation.

## 10. Complete route requirements

The following starting inventory does not limit scope. Reconcile it with the current application and add every missing public or internal route, nested view, and interaction. Existing URLs may remain while labels and grouping improve.

| Existing route | Purpose | Required redesign |
| --- | --- | --- |
| /today | Daily briefing | First visible work item or grouped blocker, then AI progress and deadlines. Move detailed setup, pipeline analysis, and full history behind links. |
| /workbench | My Work | One queue with Needs me, Waiting, and Done views. Move owner and task-type filters into a drawer. Keep act-and-next and safe skip behavior. |
| /review | Decision view | Open the selected opportunity with recommendation, supporting facts, unknowns, and Pursue or Pass. Keep deeper scoring collapsed. |
| /call-queue | Calls view | Company, phone, purpose, concise script, and last contact. One primary outcome action with optional extra outcomes. Preserve calling-off states. |
| /pipeline | Opportunities | Use consistent naming and List/Board/Table view choices. Separate lifecycle stage from who must act. Avoid several badges explaining the same condition. |
| /opportunity/[id] | Pursuit workspace | Readable title on arrival, concise summary, one next step, and contextual tabs. Consolidate repeated readiness and journey summaries. |
| /opportunity/[id]/requirements | Requirements editor | Checklist beside source on desktop; list then source/detail on mobile. Keep exact requirement selection, citations, missing-document states, and review controls. |
| /subs | Subcontractor roster | Search, trade/location shortcuts, optional advanced filters. Keep contact, qualification, availability, and preferred status scannable. |
| /subs/[id] | Subcontractor record | Contact details and readiness first. Use Overview, Work and quotes, Messages, Documents, and History. Move low-value counters into details. |
| /communications | Inbox | Threads plus focused message pane. Distinguish Needs reply, Drafts, Sent, and Delivery issues. Preserve unmatched messages and record linking. |
| /contracts | Contract collection | Active contracts first, deadline/obligation indicators, and quick detail. Keep new-contract creation in one place. |
| /contracts/[id] | Contract record | Overview, Obligations, Documents, Financials, and Activity where supported. Show subcontracting limits with explanations and evidence. |
| /compliance | Compliance workspace | Due soon and overdue first. Optional calendar. Explain document versus renewal status. Keep the ability to open the exact item needing action. |
| /activity | Action ledger | Human-readable event rows: what happened, who/what did it, related record, time, outcome. Expand recipient, message, documents, costs, and technical evidence on demand. |
| /recap | Daily summary | Concise time-based view of the same activity and work data. Each item opens its action or result. Preserve daily history and time-zone context. |
| /analytics | Reports | Replace broad metric stacks with Overview, Pipeline, Win performance, and Revenue views. Explain formulas, distinguish unknown from zero, and link charts to records. |
| /agents | Automation status | One health summary with grouped causes, affected work, and accurate recovery. Put schedules, manual runs, provider counters, and raw logs behind disclosures. |
| /search | Global search | Results grouped by record type, useful recent records, and direct navigation. Add page/action search without creating a separate competing search experience. |
| /more | Mobile navigation | Compact destination list and account switcher. Do not repeat long descriptions or recreate dashboard cards. |
| /how-it-works | Help | Searchable short task guides linked to current controls. Keep reference detail available without requiring users to read a manual to proceed. |
| /feedback | Feedback | Short form with optional screenshot and page context, plus status of prior requests. Do not automatically expose private record content. |
| /settings/profile | Company setup | Progressive sections for business details, service area, capabilities, and scoring. Save clear groups and preserve validation and change history. |
| /settings/rules | Automation rules | Plain-language defaults and impact preview. Advanced timing/scoring controls collapsed. Explicit save and clear effect on current work. |
| /settings/content | Company content | Separate reusable content, documents, and email templates locally. Editor plus preview on desktop; one pane on mobile. Preserve approved wording and permissions. |
| /settings/integrations | Connections | Show Connected, Needs attention, and Not connected with last verification. Open one setup form at a time. Keep queue/backend configuration in admin diagnostics. |
| /settings/api-usage | AI usage and limits | Current spend, budget remaining, payment responsibility, and history. Keep model/provider detail optional. Distinguish tenant keys from platform usage. |
| /settings/billing | Plan and billing | Plan, renewal date, payment status, invoices, and change-plan action. Remove repeated trial explanations; preserve actual entitlement limits. |
| /settings/recap | Daily recap preferences | Delivery time, recipients, included sections, and delivery history in focused groups. Preview actual email content; separate preview from send. |
| /settings/notifications | Notifications | Explain which alerts can be emailed and which are in-app only. Do not imply unsupported delivery channels or show an unconnected toggle as working. |
| /settings/account | Personal account | Profile, password/security, sessions, and personal preferences. Keep organization settings out of this screen. |
| /admin/accounts | Account support | Search and saved issue views. Compact account rows, read-only quick view, explicit account scope. Keep suspension, deletion, and impersonation on guarded detail actions. |
| /admin/accounts/[id] | Account detail | Customer status, current problem, and next support action. Local tabs for people, connections, billing/usage, and history. Preserve role and key-grant safeguards. |
| /admin/api-usage | Platform usage | Per-tenant provider costs and customer charges, key ownership, failed/unknown requests, and reconciliation. Keep the 1.25x platform-usage charge logic separate from UI formatting. |
| /admin/billing | Customer billing | Payment issues first, then subscription table and revenue metrics. Open an account in context. Separate financial facts from support actions. |
| /admin/health | Platform health | Group incidents by root cause and affected accounts. Clear severity, duration, impact, and next step. Expose provider/queue diagnostics only when needed. |
| /admin/audit | Admin history | Filterable immutable action history, actor/account/action/outcome, expandable before/after details, and clear time zone. |
| /admin/invitations | Invitations | Pending, accepted, and expired views. Clear role/access summary before sending; optional resend/revoke controls with honest outcomes. |
| /admin/recap | Platform briefing | Cross-account exceptions and trends. Link each account issue directly to its scoped support view. |
| /authority | Marketing operations | Keep admin-only and outside customer contracting navigation. Approvals use a focused draft plus evidence and explicit destination. |
| /opportunities → /pipeline | Compatibility redirect | Retain search/filter mappings and bookmarks; do not count this as a separate redesigned page. |
| /automation → /agents | Compatibility redirect | Retain old links and consistent destination naming. |
| /email-log → /communications | Compatibility redirect | Retain supported search/status mappings and message history access. |
| /admin → /admin/accounts | Entry redirect | Keep role checks and deliberate default destination; verify separately from content screens. |
| /settings → existing default | Entry redirect | Verify current default, role checks, and query/return behavior; inventory separately from content screens. |

Also inventory all authentication, invitation acceptance, verification, password recovery, onboarding, subscription/checkout returns, not-found, unauthorized, and public content pages. Preserve valid redirects, bookmarks, query parameters, access rules, and return destinations. Verify direct navigation and refresh for each route.

## 11. Sales landing page and public website

Redesign the homepage to sell BrostCo through clear outcomes, credible product evidence, and a structured explanation. A visitor should quickly understand who it serves, what it does, how AI and people share the work, and how to begin.

Use the same design system as the application with more expressive composition and storytelling. Build the page around real product screens and recognizable workflows. Keep the message focused on government contracting and BrostCo's verified capabilities. Avoid vague AI slogans, unsupported revenue promises, fabricated testimonials, invented customer logos, unverified security badges, and claims of guaranteed contract wins.

Recommended homepage sequence:

| Section | Content and design requirement |
| --- | --- |
| Header | Compact logo and navigation with Product, How it works, Pricing, and Resources where real destinations exist; clear Login and one main conversion action. Mobile menu must remain short and usable. |
| Hero | One concrete benefit-led headline, one concise explanation, primary conversion CTA, secondary Watch the walkthrough action, and a real product visual. Identify the audience and useful outcome above the fold. |
| Credibility | Verified customer evidence or factual product proof. If customer proof is unavailable, use an honest workflow demonstration and clearly labeled sample data. |
| Connected workflow gallery | Outcome-based tabs such as Find opportunities, Decide what to pursue, Build your team, Prepare the bid, and Track the work. Each gets a brief promise, real interface footage, short explanation, and relevant next action. Refine names to match the actual product. |
| How BrostCo works | Show the complete path from setup to useful output in a few understandable stages. Explain required connections and where users remain in control. |
| Product advantages | Demonstrate verified strengths such as follow-up coordination, subcontractor workflows, review controls, activity visibility, and recovery. Show each advantage in context rather than listing every feature. |
| AI and user control | Explain what runs automatically, what follows configured rules, and what waits for review. Show source access, status, and recovery with real UI. |
| Role or use-case guidance | Help the actual target customer recognize their workflow. Avoid generic audience segments unsupported by the product. |
| Pricing | Clear current offer, inclusions, limits, usage charges, renewal terms, and action. Verify authoritative pricing configuration; do not reuse conflicting historical promotions or invented scarcity. |
| FAQs | Answer fit, setup, data sources, human review, subscriptions, API charges, cancellation, and support using verified product facts. |
| Final CTA and footer | Repeat the core outcome and conversion action. Provide working support, product, account, and legal links. |

Choose the primary CTA based on the real conversion flow. Use a trial/signup CTA if a functioning self-service path exists, or a demo CTA if assisted sales is the actual model. Do not scatter competing signup, booking, purchase, and contact buttons with equal visual priority. Forms should collect only what is needed, explain what happens next, preserve input after errors, and show success clearly.

Write final conversion copy as part of implementation. A possible starting message is “Move from opportunity to a bid ready for review,” followed by a concise explanation of the supported discovery, coordination, and preparation workflow. Refine it against verified capabilities and customer language rather than treating this draft as a fixed headline.

Redesign every supporting public page with consistent navigation, visual hierarchy, CTAs, and links. Preserve valuable indexed content and established URL intent. Inventory redirects before changing public URLs. Preserve or improve titles, descriptions, canonical URLs, sitemap behavior, robots directives, structured data, and crawlable content. Keep private application content out of public indexing. Use only structured data supported by the visible page.

## 12. Required videos and walkthroughs

Produce real product demonstrations as part of the redesign deliverables. Do not stop at video placeholders or scripts. Record the redesigned application using a stable demo account with representative, sanitized data after its workflows function. Use original footage and assets; never reuse GovDash's recordings. Clearly identify sample data and simulated integrations where applicable. Never present a staged send or submission as a completed real-world action.

| Asset | Proposed length | Required story |
| --- | --- | --- |
| Hero preview | 10 to 20 seconds | Show the product recognizing useful work, presenting the next action, and producing an understandable result. No audio required. |
| Main platform walkthrough | 90 to 150 seconds | Explain the problem, show a connected opportunity-to-review journey, demonstrate control and visibility, then show how to start. |
| Workflow gallery clips | 20 to 45 seconds each | Record each selected workflow tab with enough context to understand the action and resulting state. |
| Focused product tours | 2 to 4 minutes when needed | Explain complex workflows such as subcontractor coordination, bid review, and automation recovery without overloading the homepage. |

For each asset, deliver a storyboard, final script, accurate on-screen labels, edited footage, poster image, captions, transcript, and destination. Narration is appropriate for the main walkthrough; silent clips need enough on-screen explanation to stand alone. Keep narration and captions plain and concise.

Record legible UI at an appropriate scale. Avoid showing an entire desktop interface inside a tiny mobile player. Use focused crops and dedicated mobile footage where necessary. Do not accelerate footage so much that the actions become incomprehensible. Each clip should show context, user or AI action, and result.

Use lightweight muted inline previews only where appropriate, with pause controls and reduced-motion handling. Full walkthroughs play on deliberate user action with standard playback, audio, seeking, fullscreen, and captions. Do not autoplay sound. Provide transcripts and a useful poster if playback fails. Lazy-load heavier players, reserve their dimensions, and prevent several gallery videos playing simultaneously. Stop or pause inactive clips and respect data-saving preferences where available.

Test video switching, mobile playback, captions, keyboard controls, focus restoration after closing a player, slow connections, and failed media requests. Avoid forms that prevent users from viewing the basic product explanation. Track meaningful playback and conversion events without capturing sensitive application content.

If a recording or narration capability is unavailable, complete the scripts, scenes, player implementation, and all usable assets, state the precise missing deliverable, and keep that acceptance item open. An animated mockup does not count as a recorded working product tour.

## 13. Engineering and implementation sequence

Work in an isolated branch or checkout. Read applicable repository instructions and inspect existing architecture before choosing replacements. Preserve domain behavior and reuse sound components rather than rewriting working systems unnecessarily.

1. Establish current route, feature, role, data, performance, and visual baselines. Create the preservation and competitive gap matrices.
2. Define the navigation model, core journeys, design tokens, and reusable layout patterns. Build rendered desktop and mobile examples of the landing page, Today, a populated opportunity, and a focused review task. Resolve design weaknesses before propagating the pattern.
3. Implement the shared shell and a complete opportunity journey, including relationships, communications, requirements, pricing, review, background work, and recovery.
4. Apply the system to every remaining dashboard, setting, account, admin, authentication, and public route. Audit tabs, dialogs, menus, and edge states separately from page shells.
5. Finish the sales narrative and public pages using accurate screens from the redesigned application. Produce and integrate the videos.
6. Verify complete journeys, accessibility, responsiveness, permissions, billing correctness, and performance. Repair findings and capture final evidence.
7. Deliver a reviewable preview, implementation summary, coverage ledger, remaining issues, and release/rollback instructions. Honor deployment authorization already present in the active session and any applicable release gates. A deployment approval request, if needed, must come after the reviewable work is ready.

Inspect likely shared implementation points including `lib/navigation.ts`, the dashboard layout, viewport wrapper, navigation and mobile bar, page frame, workspace shell, tabs, command palette, guide components/API, global styles, and screenshot tooling. Paths from earlier review may have changed; verify before editing.

Avoid introducing blocking page waterfalls, unnecessary client bundles, duplicate requests, or polling that slows navigation. Preserve background jobs across navigation. Use safe caching and invalidation appropriate to tenant data. Verify timeouts and partial failures with realistic record counts.

Maintain a concise progress and decision log so another session can continue without repeating completed work. Mark tasks complete only when implementation and the required verification both exist.

## 14. Acceptance criteria and definition of done

Treat these as proposed project targets. Verify applicable accessibility and performance guidance against current primary documentation during implementation.

| Area | Completion requirement |
| --- | --- |
| Coverage | Every discovered route and meaningful tab, menu, modal, and workflow has a recorded disposition and current evidence. Redirects are verified separately. No unexplained omissions. |
| Feature preservation | Every inventoried capability maps to working behavior in the redesign, with explicit resolution for any change in scope. No silent removals or disconnected controls. |
| Screen clarity | Representative users can identify the page purpose, next action, and whether AI is working within approximately five seconds. Record actual observations; do not invent user testing. |
| Mobile | At 390 × 844, a meaningful task or actionable blocker is visible without scrolling. At 360 × 640, critical content and controls remain usable. No overlapping action bars, covered inputs, clipped titles, or page-wide overflow. |
| Responsive coverage | Inspect representative widths of 360, 390, 768, 1024, 1440, and 1920 pixels plus landscape and keyboard-open states. Test every route at mobile and desktop sizes, with tablet coverage for distinct layout patterns. |
| Accessibility | Aim for WCAG 2.2 AA, including keyboard access, meaningful labels, visible and unobscured focus, contrast, dialog focus management, captions, and reduced motion. Use manual checks alongside automated checks. |
| Reliability | Loading, empty, populated, partial, failed, retrying, offline/reconnecting, unauthorized, and unsaved states behave accurately where applicable. No silent errors or fake success. |
| Core journeys | Verify qualification, outreach, reply handling, calls, requirements, pricing/review, delivery, recovery, ledger tracing, and account/usage management end to end using safe fixtures. |
| Roles | Test actual supported roles and entitlements, including tenant and platform-admin boundaries, trial/paid states, and platform/tenant API-key ownership. Do not invent roles the product lacks. |
| Safety of existing workflows | Tenant isolation, approval rules, duplicate-send protection, limits, billing calculations, and authoritative audit history remain correct. Test external sends and payments through appropriate test modes. |
| Task efficiency | Measure time, steps, and errors against the existing BrostCo baseline. Aim for at least a 25% reduction in median time on three common workflows without raising errors; report actual results and adjust targets if baseline tasks are already efficient. |
| Navigation performance | Give immediate, truthful feedback to navigation and actions. Establish authenticated route budgets from measured baseline and realistic data; investigate the slowest routes and demonstrate improvement. |
| Public performance | Target good Core Web Vitals: LCP at or below 2.5s, INP at or below 200ms, and CLS at or below 0.1 at the 75th percentile. Use lab checks before release and field monitoring afterward; lab results are not proof of field compliance. |
| Sales clarity | A visitor can explain the audience, outcome, workflow, limits, and next step after viewing the hero and product explanation. All claims, pricing, CTAs, and forms match functioning behavior. |
| Video delivery | Real final videos, posters, captions, transcripts, and players are present, accurate, legible, responsive, and tested. Placeholder players do not pass. |

Use realistic populated fixtures, long names, many records, missing information, and failed jobs. Capture screenshots with viewport, route, role, revision, and fixture state. Record representative complete workflows. Distinguish captured, visually reviewed, interaction-tested, and blocked statuses. A successful build alone is not evidence that a page is usable.

Run relevant build, type, lint, unit/integration, and end-to-end checks according to repository requirements and the risks changed. Add meaningful regression tests for navigation state, permissions, billing, jobs, and workflow behavior where needed. Fix visible defects through rendered review rather than substituting tests that merely mirror markup.

## 15. Required final handoff

Provide the implemented redesign and preview; final design tokens and shared components; updated navigation and route map; feature preservation matrix; competitive gap decisions; route/state/device coverage ledger; before-and-after screenshots; representative workflow recordings; complete marketing video assets and transcripts; verification results; measured performance and usability findings; and an honest unresolved-issues list.

Explain what changed, why it improves the experience, what was verified, and what remains uncertain. Report source revision and deployment status separately. Do not claim a full live audit, competitive superiority, complete feature parity, or successful production deployment without supporting evidence.

The finished product should make powerful contracting workflows feel understandable and manageable. Users should know what the platform is doing, what needs their attention, and how to act without learning the internal system.

## Reference material

The following sources informed this brief. Recheck current behavior when implementing; these links are references, not permission to reuse third-party assets.

- [GovDash product gallery](https://www.govdash.com/): focused Discover, Capture, Pricer, Proposal, and Contracts presentation.
- [GovDash interface documentation](https://support.govdash.com/docs/govdash-interface): navigation, dashboard, and quick actions.
- [Pipeline customization](https://support.govdash.com/docs/customizing-the-pipeline): views, previews, and configuration.
- [Discover opportunity records](https://support.govdash.com/docs/discover-opportunity-records): record structure and supporting details.
- [Using Dash](https://support.govdash.com/docs/using-dash): contextual assistance, sources, and ongoing work.
- [Proposal outline editing](https://support.govdash.com/docs/editing-your-outline): sections and review context.
- [Capture product page](https://www.govdash.com/capture): connected capture workflow.
- [Capture animation](https://www.govdash.com/animations/capture.html), [Pricer animation](https://www.govdash.com/animations/pricer.html), and [Contracts animation](https://www.govdash.com/animations/contract.html): curated examples of focused visual presentation.
