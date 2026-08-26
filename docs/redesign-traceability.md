# Redesign traceability

Every interface item this redesign touches, and what happened to it. Paired
with `docs/interface-inventory.md`, which is generated from the code and lists
what currently exists.

The rule this document exists to enforce: nothing is removed to make a screen
look tidier. An item may be kept, renamed, moved, combined or retired, and a
retirement has to name what made it redundant. Anything moved has to remain
reachable on both desktop and mobile.

## Status of the programme

The full brief is a multi-phase programme in the sequence its own section 20
sets out. This document is appended to as each phase lands; it is not a plan
written in advance of the work.

| Sequence step | State |
| --- | --- |
| 1. Inventory and traceability | Done |
| 2. Data truth: status, counts, scoring, activity | In progress. Automation health and account status done; scoring split and unified timeline landed earlier (see notes) |
| 3. Roles, permissions, terminology, task model | Done |
| 4. Navigation and shared design system | Done. `docs/design-system.md`, with the statically checkable rules enforced |
| 5. Desktop and mobile shells | Partly done |
| 6-9. Page-by-page | Every operator page now carries a frame; deeper per-page work continues |
| 10-12. Accessibility, performance, usability, release | Not started |

## Decisions

### Automation health

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Sidebar engine chip, computed from the worker heartbeat | Changed | Same place, now reads `assessAutomation` | Sidebar footer | Sidebar footer in the menu overlay | The heartbeat answers "is the process alive", and the chip presented it as "is the work getting done". It printed "Running normally" over an account whose every job was failing on an exhausted credit balance |
| `engineHealthy` / `engineLabel` props on `Nav` | Removed | Replaced by `automationState` / `automationHeadline` / `automationDetail` | - | - | A boolean cannot express paused or not-set-up, so both were being reported as failures |
| Page title "Automation Log" | Renamed | "Automation Health" at `/agents` | Sidebar, Performance group | More menu | The page's job is to say whether automation works, not to be a log. The log is still on it |
| Failure count banner ("412 of 480 runs failed") | Combined | `AutomationStatusPanel` + `AutomationIncidents` | Top of Automation Health | Same, stacked | A count is context for a cause, not a substitute. Every one of the 412 was the same fixable problem, and the two other problems were on page nine |
| Reverse-chronological failure feed | Kept | Below the incidents, behind "See every failed run" | Automation Health | Same | Support needs it. Operators do not need it first |
| Master switch copy "Automation is running" | Changed | "Automation is switched on" | Automation Health | Same | A switch position cannot claim that work is getting done. It sat two inches above a red "Blocked" panel |
| (new) Account-wide blocker banner | Added | Top of Today, above the greeting | Today | Today | A day planned against a system that is not running is a day wasted |

### Account and billing status

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `subscription_status` read directly by each surface | Changed | `accountStatus()` in `lib/domain/account-status.ts` | - | - | One field was answering four questions. Only one of them was its own |
| Billing page status chip | Changed | `PageFrame status` from `effective` | Billing | Billing | A comped account read "Canceled" beside an offer to reactivate it |
| Scattered plan/trial/Stripe facts | Combined | `AccountStatusPanel`, four rows plus a headline | Top of Billing | Same, stacked | Nothing ever displayed two of them at once, so nothing ever had to make them agree |
| Stripe's raw status | Kept | `stripe` row, shown to admins only | Platform Admin | Platform Admin | Softening it into "Inactive" throws away the fact that solves a support call |
| Checkout and portal links on comped accounts | Removed | `showPurchase` / `showPortal` are false | - | - | Someone told their account is free should never be offered a way to start paying |

### Counts

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `queueCounts().review` | Changed | Shares `TRIAGE_WHERE_SQL` with `actionCenter` | Sidebar badge | Tab bar badge | The badge omitted the snooze check, so snoozing an opportunity cleared it from Today and left it in the badge |

### Error states

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `(dash)/error.tsx`, "Something went wrong" | Changed | `RouteError` | All operator pages | Same | The banned phrase, and it withheld the digest, which is the one string support needs |
| `(account)` error boundary | Added | `app/(account)/error.tsx` | Billing | Billing | There was none. A failure fell through to the framework's bare screen, on the page a worried customer opens |

### Roles and permissions

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `organization_members.role` | Kept, now enforced | `lib/domain/roles.ts` | - | - | Stored, displayed, and read by nothing. Every member of an organization had identical write access, so the account labelled "read-only" could change final pricing, publish account-wide rules, delete subcontractors and submit a federal bid |
| Role checks at call sites | Not built | `requireOrgContext({ capability })` | - | - | Asking "is this an admin" at sixty call sites means re-answering it at sixty call sites the day a role is added. Code asks what it needs to do, once |
| `users.role` as the permission source | Changed | `SessionUser.orgRole`, from `organization_members` | - | - | `users.role` is platform-level and predates multi-tenancy. The membership role is what the person is in THIS organization |
| Settings pages for a role that cannot change them | Changed | `ReadOnlyBanner` plus `<fieldset disabled>` | Settings | Settings | A settings page with no Save button reads as broken. One banner naming who can change it reads as read-only |
| Checkout and portal links | Changed | Redirect to `?error=not_permitted` | Billing | Billing | A read-only user should not be able to open a checkout for the company. A JSON 403 in the address bar is not an answer to anybody |
| Legacy single-tenant accounts with no membership row | Kept working | `getOrgRoleForUser` falls back to `users.role` | - | - | Without it the founding customer would normalize to `viewer` and be locked out of writing to their own product on the day permissions shipped |

### Page frames

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `PageHeader` on Rules, Integrations, Profile, Content | Changed | `PageFrame` with breadcrumbs and a one-sentence explanation | Settings | Settings | Four settings pages more than one level deep with no way back but the browser button |

### Terminology

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| "N decisions" on Today | Changed | "N actions need you" | Today | Today | The queue holds calls, deadlines, approvals and compliance renewals, none of which is a decision. The ledger already phrased it correctly everywhere except the largest text on the busiest screen |
| "On track" on a compliance item with no expiry | Changed | "Cannot monitor" | Compliance | Compliance | A green badge asserting an item was fine when the system had nothing to check it against |
| "no date set" | Changed | "No expiry date, so this cannot be tracked" | Compliance | Compliance | Says what the absence means, not just that it exists |
| Deadline vocabulary | Kept, now named | `DEADLINE_TERMS` | - | - | A solicitation has two deadlines and calling both "the deadline" is how a subcontractor was handed the government's date as their own |
| Markup / margin / gross profit | Kept, now named | `MONEY_TERMS` | - | - | 20% markup is a 16.7% margin. Quoting one as the other loses money on a won job |
| `text-emerald-700`, `bg-amber-500` | Changed | `text-pursue`, `bg-review` | - | - | Raw palette colours cannot swap with the theme, so they survived the dark-mode toggle as stains |

### Page frames, remainder

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `PageHeader` on the three Platform Admin pages | Changed | `PageFrame`, eyebrow becomes a breadcrumb | Platform Admin | Platform Admin | "Platform admin" was already being said as an eyebrow without being a way back out of it |
| `PageHeader` on How it works | Changed | `PageFrame` | Help | More | Consistency; it is a reference page and top level, so no crumbs |
| Today's greeting | Kept | Its own frame | Today | Today | The audit specifies exactly this shape for Today: date, role-aware headline, workload sentence, count |
| Opportunity workspace header | Kept | Its own sticky record header | Opportunity | Opportunity | Carries deadline, stage, score, confidence, owner and readiness, plus a pinned back bar |

### Accessibility

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Brand gold as text colour | Changed | `--gold-text`, the same hue at 64% | Everywhere | Everywhere | 2.08:1 against the page, less than half of AA, and it carried page titles, every eyebrow and most link text. The undarkened gold stays for rules, borders and fills, where the 3:1 non-text threshold applies |
| `--slate-500` | Changed | 114 106 93 | - | - | 4.16:1, just under AA, on the tone that carries supporting text |
| `text-slate-400` on text | Changed | `text-slate-500` | - | - | 2.45:1. That tone is decoration, not text |
| Buttons at `min-h-10` | Changed | `min-h-11` on touch | - | Everywhere | 40px is close enough to look right and not close enough to hit |
| Checkbox labels | Changed | One `:has()` rule, 44px on coarse pointers | - | Everywhere | Every checkbox sits in its own label, and every label collapsed to the 16px checkbox |
| Placeholders as the only label | Changed | `aria-label` on 10 controls | - | - | A placeholder disappears the moment you type |
| `TokenMultiSelect` dropping `aria-label` | Fixed | Prop declared and forwarded | - | - | Callers were passing it; TypeScript accepted it as excess and nothing reached the input |
| `h1` to `h3` jumps | Changed | `h2` | Pipeline, Profile | Same | The outline is how a screen-reader user navigates |

### Performance

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Email log's reply lookup | Changed | Two pre-aggregated sets, hash-joined | Communications | Communications | A LATERAL running once per row: `loops=20060` to produce nine counters. 557ms to 15ms on the query, 652ms to 45ms on the page |

### One attention system

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `workQueue()` | Fixed | `lib/data.ts` | Today | Today | It queried `cc.trade`, a column that has never existed, and Today caught the error and rendered nothing. The one list of everything waiting on a person has never appeared |
| `.catch(() => [])` around it | Changed | Logs before returning empty | - | - | Still tolerant, no longer silent. That catch is why nobody noticed |
| `WorkItem` | Extended | `reason`, `blocker` | Today | Today | The queue said what to do and never why. A blocker automation named is the one thing a person cannot guess |
| One record producing two rows | Removed | `dedupeWorkItems` | Today | Today | An opportunity flagged for attention while in bid_building appeared twice, so the count at the top disagreed with the list underneath |
| Per-item owner | Not built | - | - | - | There is no assignee column. Every item is owned by whoever is looking, because the product is one queue per organization today. A field that always says the same thing is worse than no field; assignment is a feature, not a display fix |

### Edge cases

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| "0 wins - 0 losses" under the win rate | Changed | "No bids decided yet" | Analytics | Analytics | An account that has never submitted anything was being shown a track record of failure. `?? 0` turned an uncounted value into a real-looking zero |
| "-" for average margin | Changed | "No wins yet" / "Not recorded" | Analytics | Analytics | A dash cannot say which of the two it means |

### Contracts

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Active / Past, the two stored statuses | Changed | Five views: At risk, Starting soon, Active, Completed, Lost or terminated | Contracts | Contracts | Two statuses are enough to file a contract and not enough to run one |
| (new) At risk | Added | Derived, never stored | Contracts | Contracts | A stored risk flag is one somebody has to remember to clear, and the one nobody clears stops being believed. Derived from overdue milestones, a passed end date, the non-small-business cap and overdue CPARS |
| (new) Starting soon | Added | Derived from the start date | Contracts | Contracts | Insurance, subcontractor paperwork and mobilisation all have to be in hand before day one, and there was no view that showed that window |
| "Mark complete" as the only exit | Changed | Plus "Lost or terminated" | Contracts | Contracts | A contract lost or ended early was being filed as completed, which makes every win-rate and margin figure quietly wrong |
| `buildContractPlan` `cparsDue` | Fixed | Accepts a Date | - | - | node-postgres returns a Date for a timestamptz; the page cast it `as string`, which TypeScript accepted and the runtime did not. Any contract with a CPARS due date crashed the entire page, and no seeded contract had one |

### Compliance

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Headings taken from the raw `category` column | Changed | Six named areas | Compliance | Compliance | The board printed whatever categories the data happened to contain, in whatever order they arrived. Two items that answer one question ("can this company legally be awarded work") appeared as two unrelated headings, and a new category would have silently created a heading nobody designed |
| `SAM.gov Registration`, `State / LLC Registration` | Combined | Under "Company registrations" | Compliance | Compliance | Both gate an award. Checking one and not the other is checking nothing. Each item keeps its own title and its own renewal instructions, so nothing was lost |
| `Insurance` | Combined | Under "Insurance and bonding" | Compliance | Compliance | Bonding capacity had no heading of its own and shares the question insurance answers |
| `CPARS`, `Contract Deadlines` | Combined | Under "Contract-specific" | Compliance | Compliance | Both are obligations attached to work already won |
| Per-category headings | Kept, conditional | Rendered as a subheading inside an area holding more than one category, and only when the category groups more than one item | Compliance | Compliance | A heading over a single card whose own title says the same thing is noise. It earns its place when it groups |
| (new) Area explanations | Added | Under each area heading | Compliance | Compliance | "Certifications" says nothing. "Lose the set-aside you bid under" says why the date matters |
| (new) Subcontractor compliance | Added | Compliance, sixth area | Compliance | Compliance | Subcontractor paperwork lives in `subcontractor_documents` and had never appeared on the compliance board at all. The only way to see a lapsed certificate was to open each subcontractor in turn. A prime whose subcontractor's insurance has lapsed has a compliance problem whether or not the interface files it under compliance |
| (new) Engaged-only scope for the sixth area | Added | - | - | - | Most subcontractor records are prospects sourced for outreach with no paperwork because none was ever asked for. Listing all of them as "missing W-9" would be true, useless, and would bury the handful that matter. Scope is subcontractors with paperwork started or named on a contract |
| Urgent items rendered twice, once pinned and once in their category | Fixed | Pinned only, with a per-area line saying how many moved and where | Compliance | Compliance | One problem, one alert. An area that just looked emptier than it is would send someone hunting for an item that is already on the page |
| Category renewal links (`Renew on SAM.gov`, `CPARS`, `SBA certifications`, `acquisition.gov`) | Fixed | `.tap` hit area | Compliance | Compliance | 16px tall on a touch screen, well under the 44px minimum. The sweep only caught them once the board had data in it; the previous clean run measured an empty board |
| Subcontractor card title as a second link | Removed | The card's button is the single target | Compliance | Compliance | A 20px-tall title link duplicating the button below it: two targets for one destination, one of them too small to hit |
| (new) Status summary | Added | Chip row at the top of the board | Compliance | Compliance | Four counts, always for the whole account rather than the current filter. A number in a summary that moves when a filter is applied is answering a different question than the one it looks like it is answering |
| (new) State and area filters | Added | The same chip row, and a second row of areas | Compliance | Compliance | Summary and filter are one control. A summary that only reports, above a filter that only filters, makes a person read a count and then hunt for the matching filter |
| (new) Expiring-soon timeline | Added | "Landing in the next 90 days", above the areas | Compliance | Compliance | Which of these lands first is the one question an area listing cannot answer, and it was being answered by reading every card and doing the arithmetic by hand. Position on the strip, not bar width: a bar that grows with the number reads as "more" when it means "later" |
| Bad `?state=` / `?area=` parameter | Behaviour | Falls open to the unfiltered board | Compliance | Compliance | Guessing at what was meant, or failing closed to an empty board, both end with somebody looking at a page that is missing an expiry they needed to see |

### Communications

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `/email-log`, a paged list of messages | Changed | `/communications`, grouped into conversations | Communications | Communications | A list of messages answers "what happened". It cannot answer "who is waiting on me", because that is a property of a conversation and a conversation is a group of rows. The nav already said Communications; the URL now agrees |
| `/email-log` URL | Kept | Redirects to `/communications`, carrying search and filter across | - | - | The URL is in browser histories and bookmarks. A 404 on a link someone used yesterday is worse than an extra hop |
| Status filters: Sent, Opened, Clicked, Responded, Bounced, Delayed, Never sent, From them | Changed | Everything, Unread, Needs your reply, Did not arrive, Follow-up overdue, Waiting on them, Resolved | Communications | Communications | The old set described what happened to a message. The new set describes what is owed, which is what somebody opening this page is there to find out. The per-message states are all still shown, on the message |
| Three separate delivery-failure filters | Combined | "Did not arrive" | Communications | Communications | Bounced, delayed and never-sent are three answers to one question. The message still says which it was, and what to do about each |
| `sent` shown for anything not heard about otherwise | Fixed | "Sent, no confirmation yet" | Communications | Communications | A message refused by the receiving server and one that arrived and was read looked identical until you opened the row |
| (new) `blocked` as distinct from `bounced` | Added | Message state | Communications | Communications | The fixes are opposite. A bounce means correct the address; a block means the address is probably right and the sending domain needs attention. Both read "bounced" before |
| Any inbound message counted as a reply | Fixed | Out-of-office and bounce notices excluded | Communications, Analytics | Communications | An automatic acknowledgement is the absence of an answer. Counting it inflated the response rate and, worse, took a subcontractor off the chase list because the system believed they had answered |
| (new) Header counts | Added | Unread, needs your reply, did not arrive, follow-up overdue | Communications | Communications | Computed over every conversation in the account, never over the current filter or search |
| (new) Three-pane layout | Added | Conversation list, thread, related record and deliverability | Communications | Full-screen thread after selection, with a way back | The selected conversation is a query parameter rather than client state, so the back button works, a conversation is a shareable link, and the mobile rule is a CSS class rather than a second implementation |
| (new) Reply composer | Added | Foot of the thread | Communications | Communications | A page that shows you a question and then sends you to Gmail to answer it has moved the work rather than done it. Uses the existing `/api/conversations/reply`, which sends inside the existing Gmail thread |
| (new) Correct email, Call instead, Mark resolved | Added | Thread header | Communications | Communications | Each conversation state has exactly one obvious next move. Correcting the address writes to the subcontractor record and logs the old value, because proving what was on file when a message bounced is the point of a log |
| (new) Deliverability panel | Added | Right pane | Communications | Not shown | Delivery, response and bounce rates over the last 90 days. Rates are "Nothing sent yet" rather than 0% on an account that has sent nothing: "0% delivered" tells a new account its mail is failing |
| (new) Read and resolved state | Added | `conversation_flags` (migration 065) | Communications | Communications | Neither is a property of a message. Read spans a thread; resolved is a decision about one. Recorded when the thread pane mounts, never during render -- Next prefetches the list links, a prefetch runs the server component, and marking read during render meant hovering the list marked everything in it read |
| `lib/domain/email-log.ts`, `components/email-log-row.tsx`, `emailLogPaged` | Removed | Superseded by `lib/domain/message-state.ts` and `lib/conversations.ts` | - | - | The page that used them is gone, and their status vocabulary could not tell a policy block from a bad address, so the two states that need opposite fixes read the same. Two vocabularies for one thing is the drift this whole pass exists to remove |
| "Assign" and per-conversation owner | Not built | - | - | - | There is no assignee column anywhere in the schema. Same reasoning as the attention system: a field that always says the same thing is worse than no field |
| "Resend" as a button | Not built | The composer, with the corrected address | Communications | Communications | Resending the identical message to the identical bad address is the one thing that certainly will not work. Correcting the address and writing a line is the actual repair, and both are here |

### Quick-detail drawer (Opportunities and Subcontractors)

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| (new) Quick-look drawer | Added | Right-hand column beside the table; a full sheet on a phone | Opportunities (table view), Subcontractors | Both, from the card list | The tables answer "which of these" and the record pages answer "everything about this one". Between them is the question people actually ask while scanning: is this the one. Answering it meant opening the record, reading four fields, and coming back to a table that had forgotten where you were |
| Peek selection | Behaviour | `?peek=<id>` on the list URL | - | - | Back button works, the peek is a shareable link, filters and paging survive it, and the mobile behaviour is a CSS class rather than a second implementation |
| Bare reliability score out of 100 | Changed | A breakdown that sums to the score | Subcontractors drawer | Subcontractors drawer | The audit asked for this specifically. A score nobody can explain is a score nobody can argue with, which sounds like an advantage until an operator disagrees and has no way to check whether the system or their memory is wrong. The arithmetic moved out of the learning loop into `lib/domain/reliability.ts` so the number stored and the breakdown shown cannot disagree |
| Reliability, when the stored column is stale | Changed | Says so, and shows both | Subcontractors drawer | Subcontractors drawer | The column is rewritten nightly and outreach happens in between. Showing one number silently would leave an operator with two figures and no way to tell which is current |
| Zero reliability on a blocked firm | Changed | "Zero here is a decision somebody made, not a measurement" | Subcontractors drawer | Subcontractors drawer | A blocked firm and a firm that performed badly read identically at 0 and are not the same thing |
| Fit and confidence | Kept separate | Opportunity drawer | Opportunities | Opportunities | Averaging them would make a well-fitting job with a scanned PDF indistinguishable from a poor one that parsed cleanly |
| A malformed `?peek=` value | Fixed | Returns no drawer, list intact | - | - | The id went straight into a `uuid =` comparison and Postgres raised, so a mistyped URL took the whole roster page down instead of showing no drawer |
| Drawer bottom on a phone | Fixed | Clears the mobile tab bar | - | Both | A `fixed inset-0` sheet escapes the padding `.page-main` makes for the tab bar, so the last section of every drawer scrolled underneath it and read as the record ending there. Raising the z-index does not work: an ancestor creates a stacking context the sheet cannot climb out of |
| Edge-case sweep teardown | Fixed | Deletes `agent_logs` and `conversation_flags` too | - | - | Rendering a page writes an automation-status log line, so teardown hit a foreign key violation and left the throwaway org behind for the next run to trip over |

- **No quick-detail drawer on Contracts or Compliance.** Both are card
  boards where every field the drawer would carry is already on the card, and
  the compliance cards are editable in place. A drawer there would be a second
  way to read the same thing.

### Today

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| "Needs you: N" as the only count | Changed | Four counters: Overdue, Due today, Remaining, Completed today | Today | Today | "How much" is the least useful of the questions somebody opening this page has. How much of it is already late is what decides whether this is a normal morning, and it was not on the page at all |
| (new) Counters double as the filter | Added | The counter row | Today | Today | Reading a number and acting on it is one click rather than reading a number and then finding the control that matches it |
| (new) Queue search and kind filters | Added | Above the queue | Today | Today | At a dozen items the queue is a list you read; at eighty it is a haystack. Filtering by kind is how somebody with half an hour and a phone works only the calls. Driven through the URL, so a filtered queue is a link and there is one definition of "overdue calls" rather than one on the server and one in the browser |
| Queue showed six items | Changed | Five, as specified | Today | Today | - |
| (new) Completed today | Added | Foot of the page, quieter than the queue | Today | Today | Counted from what the work leaves behind -- calls placed, quotes entered, bids submitted, decisions recorded, compliance resolved -- and never from the queue. The queue is what is left, so deriving it from an empty queue would give the same answer for "nothing to do" and "everything done", which are opposite mornings |
| Completed-today day boundary | Behaviour | The server's day | Today | Today | Named on the page rather than papered over. Passing a timezone from the browser arrives one render late and would make the counter flicker |
| An item with no deadline | Behaviour | Counts as Remaining, never Overdue | Today | Today | Treating an absent date as a passed one is the same lie as showing 0 for an unknown count, and here it would fill the overdue counter with work that is not late and cannot become late |
| `WorkItem.due` typed `string`, holding a `Date` | Fixed | Normalized to ISO at the query boundary | - | - | node-postgres returns a Date for a timestamptz. Nothing sliced it yet, so nothing had crashed yet -- which is exactly the state the Contracts page was in until one row with a CPARS date took the whole page down |

### Review

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| A flat list of cards | Changed | Two panels: queue left, decision brief right | Review | Queue, then a full-screen brief once one is chosen | Review is a page whose entire job is a yes or no, and it was a list of summaries. A card is a summary; a decision needs the argument |
| (new) Decision brief | Added | Right panel | Review | Full screen after selection | In the order somebody actually makes the call: recommendation, why, what is in its favour, what is against, what is not known, the dates, what pursuing it costs |
| (new) Three-outcome recommendation | Added | Head of the brief | Review | Review | Pursue, pass, or "needs a person to look". The third is the honest answer for a solicitation nobody could read: recommending a pass on thin data teaches an operator that the system rejects whatever it does not understand, and scanned PDFs are common |
| (new) Effort estimate | Added | Foot of the brief | Review | Review | Stated in work -- trades to source, a package to assemble -- never in minutes. The last effort estimate this product printed was the item count times six, a constant wearing the costume of a measurement |
| Pass with no reason | Changed | Pass requires a reason, enforced at the endpoint | Review, and bulk | Review | Passing is what the scoring learns from. A pile of passes with no reasons is a pile of rows nobody can use. Enforced in the route rather than only in the form, because the route is what other callers reach |
| Per-card "Pass on this" | Removed | The brief's Pass, which asks for the reason | Review | Review | It passed with no reason, which is the thing being fixed, and the brief beside the card now carries the same decision with the reason box attached |
| Bulk pass confirmation | Changed | Asks for the reason instead of "are you sure" | Review | Review | "Are you sure?" is answered yes every time and teaches nothing. Without the change the button would simply have started failing, since the endpoint now refuses a reasonless pass |
| (new) Extend the review timer | Added | Brief controls | Review | Review | A borderline opportunity is dismissed automatically when its timer runs out, which is right for the ones nobody looks at and wrong for the one somebody is waiting on a call about. The only way to keep it was to pursue it, which files a decision that has not been made |
| (new) Request more analysis | Added | Brief controls | Review | Review | Re-queues the stage's agents. Existed as an endpoint, was not offered on the page whose job is deciding |
| Deadline and auto-dismiss shown together | Changed | Two labelled dates | Review | Review | One is the government's and one is ours. Conflating them is how somebody misses a bid because a review timer expired |
| Confidence absent | Fixed | "Data confidence not measured on this one" | Review | Review | A missing confidence is unmeasured, not certain. The brief was saying "everything the scoring needed was in the notice" about records nobody had ever assessed |
| Confidence read from `solicitation_analysis` | Fixed | Read from `score_breakdown` | Review, Opportunities drawer | Both | It was never there, so every record reported "not assessed". It describes how much of the notice could be read at scoring time, which is a property of the scoring |
| `hrefFor` function prop into a client component | Fixed | A string prefix | - | - | TypeScript accepted a function prop across the server/client boundary and the render threw. The page returned nothing at all until it was found |

### Call Queue

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Workspace opened as a modal over the queue | Changed | A permanent split: queue left, call right | Call Queue | Full-screen call after selection, with a way back | An operator making eight calls in a morning finishes one and starts the next, and a dialog that closes and reopens between every pair puts a full-screen transition in the middle of that rhythm |
| One workspace component, two frames | Behaviour | `variant="inline"` drops the backdrop and the dialog semantics | - | - | Only the frame differs. A separate inline component would be two copies of a twenty-field form, and the copy that gets fixed is never the one somebody is using |
| Which call is open | Changed | `?open=<id>` on the queue URL | - | - | Back button, shareable link, and the mobile rule as a CSS class rather than a second implementation. The deep link from Today already used this parameter |
| "N calls ready" | Changed | Calls to make, how many are on a bid due inside two days, how many are outside working hours there | Call Queue | Call Queue | A count answers how many. What stops a call happening is what decides which one to make |
| (new) Local time where the subcontractor is | Added | Queue row | Call Queue | Call Queue | An operator who cannot see it is five in the morning there finds out by dialling |
| Local time for a state spanning two zones | Behaviour | Says the hour is not certain, and shows none | Call Queue | Call Queue | Florida, Texas, the Dakotas, Kansas, Nebraska, Indiana, Kentucky, Tennessee, Michigan, Oregon and Idaho are left out of the map rather than guessed at. A confident wrong hour is worse than none: it is the difference between checking and dialling |
| (new) Contact quality | Added | Queue row | Call Queue | Call Queue | A confirmed email and an unconfirmed one are different facts, and a card with no phone cannot be called at all |
| (new) Why this call is happening | Added | Queue row | Call Queue | Call Queue | Reconstructed from memory every time, and got wrong on the tenth call of the morning. A subcontractor who wrote back is a different conversation from one who has ignored two emails |
| (new) Last contact on the row | Added | Queue row | Call Queue | Call Queue | Listed in the audit as a required row field, and it was not there |
| (new) Search and grouping | Added | Above the list | Call Queue | Call Queue | Group by opportunity or by trade. Grouping keeps the incoming order inside each group, because the queue arrives soonest-deadline first with replies on top and regrouping must not quietly resort it |
| The "start here" plan | Changed | Hidden while a search or grouping is active | Call Queue | Call Queue | It names the call to start with, so beside a filtered result it points at a card that is not on screen |
| Per-card Skip on Today, 40px tall | Fixed | `min-h-11` on touch | Today | Today | Under the 44px minimum since it was written. The sweep only saw it once the account had call cards for that section to render at all |
| "Time there unknown" at 2.25:1 | Fixed | `text-slate-500` | Call Queue | Call Queue | Well under the 4.5:1 a 12px string needs, and a caveat about not knowing something must not be the hardest thing on the row to read |

### Opportunity workspace

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Six sections: Brief, Details, Coverage, Pricing, Files, More | Changed | The seven the audit names: Overview, Requirements, Subs and outreach, Pricing, Documents, Submission, Activity | Opportunity | Opportunity | - |
| Submission at the foot of the Pricing tab | Changed | Its own section | Opportunity | Opportunity | It is the gate that decides whether a bid goes out, and it sat below the quote table, below the comps, below the competitive read, reachable only by scrolling a tab named after something else |
| Activity behind a tab labelled "More" | Changed | Its own section | Opportunity | Opportunity | "More" describes a tab's position rather than its contents, and it is where things go when nobody wants to decide where they belong |
| Workflow tracker in "More" | Combined | Overview, under the banner it duplicates | Opportunity | Opportunity | It said so itself: "same tracker as the top banner." A duplicate of the banner belongs under the banner |
| "Brief", "Details", "Coverage", "Files" | Changed | "Overview", "Requirements", "Subs and outreach", "Documents" | Opportunity | Opportunity | The audit names them, and three of the four old names described the content rather than the question the section answers |
| `#submission`, `#more`, `#workflow`, `#overview`, `#docs`, `#quotes` | Kept | All still resolve | - | - | Links to `#submission` are in Today's queue, in the guide, and in emails people sent themselves. `#more` is in nothing anyone wrote, and it cost nothing to keep working |
| Submission with no bid | Changed | "Nothing to submit yet", with what will appear there | Opportunity | Opportunity | The section previously did not exist at all before a bid was assembled, so the answer to "where do I submit this" was nowhere |

### Subcontractor record

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| A stack of collapsibles in a two-column grid | Changed | Seven named sections | Subcontractor record | Subcontractor record | The audit names them, and the old shape meant the answer to "can we send this company work" was a panel somebody had to find |
| (new) Activity | Added | Its own section | Subcontractor record | Subcontractor record | The unified timeline existed and only the opportunity record used it, so a subcontractor's page could show their emails and their quotes but not the decisions taken about them |
| Compliance and Documents | Combined | One section | Subcontractor record | Subcontractor record | A subcontractor's documents are their compliance. The file and whether it is still valid are the same row, and splitting them would put a certificate on one tab and the fact that it expired on another |
| Notes in a permanent right-hand column | Changed | Its own section | Subcontractor record | Subcontractor record | A column that is always there is a column that is always taking a third of the width, on a page where six other things want it |
| `#compliance`, `#sub-contact`, `#pairings`, `#conversations`, `#notes` | Kept | All still resolve | - | - | The compliance badge in the record header links to `#compliance`, and the guide points at `#sub-contact` |
| `buildActivityTimeline` rejecting a `Date` | Fixed | Accepts either | Both records | Both records | node-postgres returns a Date for a timestamptz and every row fed to the builder came straight from a query, so the string-only check dropped every event. Both activity timelines rendered "No activity yet" over records with a hundred emails on them. Not an empty state but a false statement, and invisible because the failure mode of a timeline is silence. The subcontractor record went from 0 events to 478 |

### Mobile application shell

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Four bottom tabs: Today, Opportunities, Subs, Calls | Changed | The five the audit names: Today, Opportunities, Subcontractors, Inbox, More | - | Bottom bar | - |
| (new) Inbox tab | Added | Fourth slot | - | Bottom bar | It takes the slot over Calls because of who is waiting: a subcontractor who has written and had no answer is waiting on a person right now, while a call is something to go and do. Its badge counts conversations needing a reply, from the same list the Communications page renders rather than a shortcut query |
| (new) More screen | Added | `/more` | Reachable, never linked | Bottom bar | Contracts, Compliance, Analytics, Automation Health, the Knowledge Center, Settings and Platform Admin were reachable on a phone only by opening the navigation drawer, which is the desktop sidebar wearing a different coat |
| Calls tab | Moved | Work group on More, with its badge still on Today | - | More | Batch calling is a real work mode and it keeps its own entry. The work queue on Today is the other door into it |
| Full labels on narrow tabs | Behaviour | Visible text shortened, accessible name full | - | Bottom bar | The audit asks for accessible full labels for Subs and Inbox. Five slots on a 390px screen cannot hold "Subcontractors", so the full word is the accessible name and the visible text is short |
| Floating "Guide Me" launcher | Removed | The sidebar entry, and a new one in the mobile app bar | Sidebar | App bar | It sat pinned to the bottom-right of every desktop page, over the content, which is the one thing the audit says not to do with this control. It was also the second way to open the same panel |
| Guide Me on a phone | Fixed | The app bar | - | App bar | It was reachable only by opening the navigation drawer and scrolling to the top of it: three taps to ask for help with the screen you are already looking at |
| `/more` at desktop width | Behaviour | Renders normally | Desktop | Mobile | Hiding it with a media query meant a direct visit or a bookmark showed a blank screen, which is a worse answer than a list of links somebody did not need |

### Integrations

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `Connected` / `Error` / `Not set up` | Changed | The six the audit names: Not configured, Saved never tested, Working, Degraded, Blocked, Expired | Integrations | Integrations | Three outcomes for a question with six answers, and the middle one was a claim the page could not support. `Connected` meant "a key is saved", and the page's own comment already recorded what that cost: it said `Connected` through a day in which the provider refused every request for want of credit |
| A saved key reading as a working one | Fixed | "Saved, never tested" | Integrations | Integrations | "We have not checked" is a true thing to say. "It is working" is not |
| A passing check with no expiry | Fixed | Stops counting after 30 days | Integrations | Integrations | A key that worked five weeks ago tells you about five weeks ago. The threshold is a named constant rather than a buried comparison, so it can be argued with |
| (new) Blocked, separated from degraded | Added | Card state | Integrations | Integrations | A credit refusal and a rate limit look alike and need opposite responses: one needs somebody to go and pay, the other needs nobody to do anything because work retries. Classified with the same function the automation incidents use, so the two panels group failures the same way |
| (new) Expired, ahead of the error it caused | Added | Card state | Integrations | Integrations | A lapsed OAuth connection produces an auth error, and reporting the symptom sends somebody to replace a key that is fine |
| (new) Reason and next action per card | Added | Under the badge | Integrations | Integrations | A state without a reason is a colour |
| "N of M connected" | Changed | "N of M confirmed working", and what needs attention | Integrations | Integrations | The header was making the same unsupported claim as the badge, one level up |

### Analytics

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| (new) `Found -> Scored -> Pursued -> Subs contacted -> Quotes received -> Bid built -> Submitted -> Won or lost` | Added | Top of the page, under the range | Eight bands | Eight bands, full width | The audit names this funnel and the page had no funnel at all: it had a stage table showing where value sits today, which is a snapshot, not a conversion story |
| Conversion rates | Added | Beside each band | Analytics | Analytics | Every rate is `number \| null`. A step whose predecessor is empty has no rate, and printing `0%` there says the work failed when it never started |
| A step that converted nothing | Behaviour | "none of the step before" | Analytics | Analytics | A zero conversion and an absent one are different facts and looked identical as bare zeroes. One means the work stopped here, the other means there was no work to stop |
| Time in stage | Added | Under each band, where measurable | Analytics | Analytics | There is no stage-history table, so only four spans have real timestamps on both ends. The other four say "not recorded" rather than showing a plausible zero |
| Work that stopped short | Behaviour | Split into closed and still open | Analytics | Analytics | A cohort found last week has not had time to be won or lost. Counting "has not reached submitted" as a drop reads as "you lose everybody at bidding" when half of them are quoting right now |
| Global date range | Added | Chips at the top of the page, in the URL | 4 chips | 4 chips | Item 1 of the desktop spec, and absent. In the URL so a period is a link and the back button works |
| Comparison period | Added | Under the funnel | Analytics | Analytics | Item 1 also asks for a comparison. Growth from nothing gets no percentage, and a period where both sides are empty gets no sentence at all: comparing nothing with nothing is not a comparison |
| Breakdowns with no date on them | Fixed | Dated on every stored panel | Analytics | Analytics | `latestKpiSnapshot` dropped `created_at`, and the page described the result as "the latest Analytics Engine run". A win rate by agency from six weeks ago is not wrong; reading it as this week's is. Past a week the page says so and asks for a re-run |
| Known versus modelled | Added | Provenance panel under the range | Analytics | Analytics | Item 2 of the spec. The honest answer differs by section: the funnel and headline figures are counted at page load, the breakdowns are a dated copy, and exactly one panel (Cash Flow Projection) is a forecast. Each is labelled as what it is |
| Cash flow with a missing horizon | Fixed | "Not projected" | Analytics | Analytics | `currency(null)` rendered a bare dash next to two real figures, which reads as nought |
| (new) Drill-down by agency, NAICS, state, set-aside, score band | Added | Table under the funnel | 5 chips + table | Chips + scrolling table | Items 5 and 6 of the spec, over the same cohort as the funnel so the two always agree. The dimension is chosen from a fixed list and mapped to a fixed SQL expression, never interpolated, so a drill-down cannot become a column selector |
| Win rate in the drill-down | Behaviour | Wins over decided bids | Analytics | Analytics | Dividing wins by submissions counts every bid still sitting with the agency as a loss. A row with nothing decided has no win rate and says so, rather than marking an agency you have never lost to as a losing one |

### Automation Health

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `Failure rate (24h): 0%` | Fixed | "No runs in 24 hours" / "Too few runs to say (N)" / "19% of 32" | Summary | Summary | A rate of nought is a claim of a perfect record, and an account where nothing ran has no record to be perfect. The stopped machine read as the flawless one, which is the exact failure this page exists to prevent |
| Four summary facts | Changed | Seven, the ones the audit lists | Summary | Summary | Active incidents, workflows affected, and next scheduled run were absent. Every rate now carries its denominator |
| (new) Next scheduled run | Added | Summary, and each roster card | Summary + roster | Summary | The sentence that stops somebody re-running by hand work that was about to run on its own. Computed from the cron rather than stored, and null wherever the expression is unrecognised, event-triggered, or fires beyond a week: a confident wrong time on this page is worse than no time |
| "77 open opportunities affected" beside "no active incidents" | Fixed | "77 open opportunities waiting, while paused" | Summary | Summary | On a paused account nothing was failing, the work was switched off. The number was right and the word was wrong, and together they read as a contradiction |
| (new) Provider usage and credit | Added | Under the incidents | Panel | Panel | Item 6 of the audit's structure, absent entirely. Three things stop every agent overnight and none of them announced itself: a spent balance, a lapsing grant, and a trial allowance reaching its cap |
| (new) Expiring key grant | Added | Provider panel | Panel | Panel | A grant with an end date is a scheduled outage. Nothing in the product mentioned it until after every agent had stopped |
| (new) Trial allowance bar | Added | Provider panel | Panel | Panel | Drawn only where a cap actually exists. An account on its own key is bounded by its own billing, and a progress bar against a number this system did not set would be fiction |
| (new) Token usage and cache hit rate | Added | Provider panel | Panel | Panel | Absent as an absence, never as a row of zeroes: "we made no calls" and "we made calls that consumed nothing" cannot both be true |
| Credential source | Fixed | Five sources, including the founding account's environment key | Panel | Panel | The first draft mirrored four of the resolver's five branches and reported "no AI credential" on the one account where every agent was in fact running |

### Company Profile

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Auto-pursue threshold, changed blind | Fixed | Live preview under the fields | Preview panel | Preview panel | This is the only control on the platform that starts outbound email with no further human step. Moving it from 70 to 60 sends real mail to real subcontractors about work nobody decided to bid, and the page gave no indication of that. The preview counts the opportunities that would change recommendation and says "which includes emailing subcontractors" in those words |
| (new) Threshold validation | Added | Beside the fields | Inline | Inline | A review floor at or above the pursue score leaves no review band, so nothing is ever offered for a decision. That is refused. Auto-pursuing at 30 is legal and alarming, so it warns and still saves: refusing it would be the page overriding its user |
| Threshold preview scope | Behaviour | Scored work that has not started running | Preview | Preview | Raising the threshold does not un-start work already in progress, and counting it would overstate the change. Dismissed rows are included, because lowering the floor is exactly how they come back |
| SAM.gov import, applied blind | Fixed | Field-by-field comparison before applying | Comparison list | Comparison list | The card showed what SAM holds and never what it would replace. Somebody who had corrected a legal name or curated fourteen NAICS codes down from a registration listing forty pressed one button and lost that work with no warning and no undo |
| Import, all or nothing | Changed | Per-field selection | Checkbox per field | Checkbox per field | The common case is wanting the UEI and the address from SAM while keeping the NAICS list you built, and an all-or-nothing import cannot express it |
| Which fields are ticked | Behaviour | Fills ticked, overwrites not | Comparison | Comparison | Adding what you do not have is what somebody pressing import wants. Overwriting what you typed is a separate decision and should cost a deliberate click |
| What a list import costs | Added | Named, not counted | Comparison | Comparison | "Replaces your NAICS codes" and "drops 238210 and 238220, keeps 2, adds 238910" are the same fact at two very different levels of usefulness |
| A field SAM does not carry | Behaviour | "Not on the registration", left alone | Comparison | Comparison | Treating "SAM has nothing" as "set it to nothing" is the version of this bug that empties a field instead of overwriting it |

### Automation Rules

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| The 48-hour follow-up interval | Changed | An Outreach rule | Outreach tab | Outreach tab | It was `48 * 3_600_000` in the outreach agent. It is a rule about how often this account writes to other people's businesses, which is exactly the kind of thing the page called Automation Rules exists to hold |
| One follow-up, ever | Changed | A rule, defaulting to one | Outreach tab | Outreach tab | One was not a decision, it was structure: the send consumed the follow-up marker and nothing ever wrote another. Now the count is chosen, and zero (never chase) is a choice somebody can make |
| The 50-per-run send cap | Changed | An Outreach rule | Outreach tab | Outreach tab | A cap that decides how a backlog reaches a mail provider should be visible to the person whose sending reputation it protects |
| (new) Plain-English summary of the chase | Added | Under the fields | Outreach tab | Outreach tab | "48 hours" and "1" are two numbers; "receives 2 emails in total, the last about 2 days after the first" is the thing being decided |
| Calling hours | Added | A Calls rule, in the subcontractor's local time | Calls tab | Calls tab | The queue already worked out the hour where each firm is, and then offered the card anyway. Computing a fact and not acting on it is how somebody rings Hawaii at five in the morning |
| Call attempt limit | Added | A Calls rule | Calls tab | Calls tab | Attempts were counted and displayed and never acted on, so a number that had rung out eleven times came back to the top of the day forever |
| A card the rules say not to ring | Behaviour | Stays in the list, says why | Queue row | Queue row | Hiding it would leave an operator wondering where the work went, and the rule that produced the silence is the one thing they would need in order to change it |
| Queue header counts | Changed | Count the configured window, and the spent numbers | Header | Header | The header counted a fixed 8-to-6 while the rows used the operator's window, which is two answers to one question |
| (new) Conflicts before publishing | Added | Above the save button | Panel | Panel | Each field validated itself, but the interesting mistakes are pairs: a red warning further out than the amber one, a calling window an hour wide, every follow-up landing inside a day. No single field can catch those |
| `null` stored for a numeric rule | Fixed | Falls back to the default | Everywhere | Everywhere | `Number(null)` is 0, and 0 means "no limit" for several of these rules, so an absent key was quietly storing the most permissive setting available |

### Content Library

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| (new) Spam-risk and length checks | Added | Under the blocking problems | Warning panel | Warning panel | Item on the audit's list, and the gap it filled is real: the editor could say whether a template was correct and never whether it would arrive. A subject in block capitals with two exclamation marks lands in a junk folder however correct its variables are |
| Warnings against refusals | Behaviour | Separate panels, different weight | Editor | Editor | An unknown variable cannot be saved; a shouting subject is legal and ill-advised and the writer decides. A warning shown at the weight of a refusal is either ignored or obeyed, and both are wrong |
| Placeholder length | Behaviour | Measured as its value | Editor | Editor | Counting `{{opportunity_title}}` as nineteen characters would tell somebody to shorten a subject that renders to nothing of the sort |
| Bulk-phrase list | Behaviour | Short and specific to this trade | Editor | Editor | A long generic list flags "free issue material" and trains the operator to ignore the panel, which costs more than it saves |
| (new) Usage, open, reply and bounce per template | Added | Above the editor | Metrics strip | Metrics strip | The audit asks the template list to carry them, and the page carried none. A subject line that had been quietly bouncing for months looked identical to one answered every time; the seeded account turns out to be bouncing 38.9% of its outreach |
| Attribution | Behaviour | From the send record's own stamp | Data layer | Data layer | The sender already writes `kind` and `threaded`, which distinguish exactly the three templates this page edits. Matching subject text would break the moment somebody edited a template, which is the one thing this page exists to let them do |
| Open rate of nought | Fixed | "None recorded" | Metrics strip | Metrics strip | An account whose tracking never fires, whose recipients block images, and one nobody opens all produce the same zero. `0%` sends somebody to rewrite wording that may be working perfectly well |
| Reply rate of nought | Kept as a rate | Metrics strip | Metrics strip | Metrics strip | Replies arrive through the inbox poll rather than through a pixel, so nought replies means nought people wrote back, which is exactly what somebody rewriting wants to know. The two zeroes are not the same kind of fact and are not shown as though they were |
| Opens over sends | Fixed | Opens over delivered | Metrics strip | Metrics strip | Counting a bounced message as an unopened one blames the wording for an address that never existed |
| A thin history | Behaviour | Says it is thin | Metrics strip | Metrics strip | Three sends and one reply is a 33% reply rate and no evidence of anything |

### Billing

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| `Past due`, and nothing else | Fixed | A panel with the reason, the retry date and the consequence | Under the status | Under the status | Stripe told the webhook why the card was refused and when it would be tried again, the webhook put both in an email, and the page that email pointed at could not answer the question the email raised |
| The retry date | Fixed | Stored, not only emailed | Data layer | Data layer | `next_payment_attempt` and the hosted invoice URL arrive on the failure event and were dropped on the floor. The invoice URL is per-invoice, so it cannot be reconstructed from the customer id later |
| A retry with no date | Behaviour | "No further attempt is scheduled" | Panel | Panel | Stripe stops scheduling attempts on the last one. "We will try again" with no when reads as a reason to do nothing, on the one occasion where doing nothing costs the account |
| A retry date in the past | Behaviour | Treated as no retry | Panel | Panel | A stale date is worse than none: it tells somebody to wait for a moment that has already gone |
| A bank confirmation | Changed | Its own state | Panel | Panel | `action_required` is not a decline, and no retry clears it. Folding the two together sends somebody to wait for an attempt that will fail the same way |
| The consequence of not paying | Added | Under the reason | Panel | Panel | "Past due" says there is a problem without saying what it costs, and the cost, losing the pipeline mid-bid, is what decides whether it gets dealt with today or on Friday. It also says nothing is deleted, which is true and is the other half of the anxiety |
| Plan headline price | Fixed | What this account is actually charged | Subscription card | Subscription card | The card printed the list price for the plan key in its largest text and the real Stripe amount in small text three inches below. A grandfathered account read "Founding, $497/mo" over "$299 per month", and the bigger number was the wrong one |
| A comped account's plan, price, renewal and portal | Removed | Replaced by what applies | Subscription card | Subscription card | The audit asks for the irrelevant pricing and portal content to be removed rather than emptied. An owner told their account is free reads a card of dashes and "No plan selected" as a page that is broken |
| A healthy subscription | Behaviour | No panel of its own | Billing | Billing | The status panel already says payments are up to date. A green box saying "fine" on every visit is how somebody learns to stop reading this part of the page, which is the part that will one day say something urgent |

### Customer billing admin

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| "Anything here that disagrees with Stripe ... is worth checking" | Fixed | A reconciliation panel at the top | Conflict cards | Conflict cards | The page ended by telling the reader to go and compare every row by hand, on a page they open when something has already gone wrong. Nobody does that, so nobody found the account that had been past due since March and using the product throughout |
| (new) Webhook freshness | Added | Top of the page | Panel | Panel | Renewals, failures and cancellations all arrive by webhook. When delivery stops, every figure here quietly stops being maintained and the page carries on looking authoritative |
| Webhook silence | Behaviour | Judged against whether there is anything to hear | Panel | Panel | A deployment with nothing subscribed hears nothing from Stripe for weeks, correctly. Calling that broken would cry wolf on every new install and teach the reader to ignore the one that matters |
| (new) Comped and still billing | Added | Conflict card | Card | Card | An account told it pays nothing, being charged. Whichever way round it happened, it gets found on a bank statement rather than here |
| (new) Suspended and still billing | Added | Conflict card | Card | Card | Charging an account for a product it cannot open is a refund and a complaint |
| (new) Past due beyond the grace | Added | Conflict card | Card | Card | `past_due` grants full access deliberately, so a failed renewal does not lock somebody out mid-bid, and nothing ever ended that window. Stripe stops retrying long before three weeks |
| (new) A Stripe subscription with no status on file | Added | Conflict card | Card | Card | The exact shape a dropped webhook leaves behind, and the customer may be locked out of something they are paying for |
| (new) Active with no price | Added | Conflict card | Card | Card | Counted as paying, contributing nothing, so the MRR on this page is understated by however many of these there are |
| A past-due row's next attempt | Added | Table column | Column | Column | Stored from the failure event rather than inferred. A retry Stripe has not scheduled reads "none scheduled" rather than as one it has |
| Conflicts fixed automatically | Not done | - | - | - | Several of these are legitimate states somebody chose, and a deliberate choice and an accident look identical from here. Each card says what disagrees and what it costs; a person decides |

### Platform Admin Accounts

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| "Accounts" headline count | Fixed | The platform total | Summary card | Summary card | It read the current page, so 25 rows out of 300 organizations reported 25 accounts, directly under a comment saying these counts describe the whole platform and not the current filter. The other three were right, which is what made the wrong one easy to believe |
| Static summary cards | Changed | Each one filters the table | 5 cards | 5 cards | The audit asks for clickable summary cards, and a count nobody can act on is a decoration |
| (new) Never signed in | Added | Card and filter | Card | Card | Never and not lately are different accounts. One is a failed onboarding and recoverable; the other is churn already under way, and collapsing them into "inactive" loses the part that says what to do |
| A signup from this morning | Behaviour | Not flagged | Table | Table | An account created an hour ago has not failed at anything, and chasing it wastes everybody's time |
| (new) Last used column | Added | Table | Column | Column | Access, plan and status read identically for an account signed up today, one working daily, and one paying monthly that nobody has opened since March |
| Support sessions | Behaviour | Not counted as use | Data layer | Data layer | An administrator opening a support session is not the customer using their account, and counting it would make every account anyone investigated look freshly active |
| Filters | Added | Plan, use, signed-up, on trial | Toolbar | Toolbar | Four of the dimensions the audit names were missing |
| Recent admin activity | Moved | `/admin/audit`, its own area | Audit page | Audit page | The audit asks for it, and the reason is that it answers a different question: this page is "which account is in trouble", the log is "what did we do to somebody". Fifteen arbitrary rows under a table that scrolls was neither a summary nor a record |
| Test history in the audit view | Fixed | Filtered by the acting address too | Audit page | Audit page | The name matcher only fires on a target organization, and an invitation action has none, so every test invitation ever revoked sat in the production view looking like real history. On the seeded database that was fourteen rows of it. RFC 2606 reserves `.test` and the `example.*` domains, so an administrator at one is a fixture with certainty rather than by inference |
| That address signal | Not used for deletion | - | - | - | The organization matcher is strict because a false positive there destroys a customer account. This one decides only whether a log line appears by default, and the toggle brings everything back |

### Platform Admin Account Detail

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| "There is no undo and no backup" | Fixed | A scheduled deletion with a 30-day window | Danger zone | Danger zone | The audit requires a recoverable grace period where technically possible, and it plainly was. The confirmation is typing the account name, which rules out misclicks, so what the old button could not protect against were decisions: the wrong one of two similar accounts, a cancellation reversed the next morning, a support request misread |
| Deletion and suspension | Behaviour | Scheduling suspends immediately | Danger zone | Danger zone | Stopping the account is the part the administrator actually wanted now. Destroying the data is the part that cannot be taken back, and only that half is deferred |
| Cancelling a scheduled deletion | Added | Danger zone | Button | Button | Nothing was touched during the window, so cancelling restores everything. It also lifts the suspension it applied, and leaves alone a suspension that predates it, because that was a different decision about something else |
| (new) A reason, required | Added | Danger zone | Field | Field | "Who deleted this and why" is the question asked six months later, and the audit row can only answer it if somebody was asked at the time |
| What deletion keeps | Added | Stated in both states | Danger zone | Danger zone | The audit asks permanent deletion to explain retention. The honest answer has two halves that are easy to conflate: the customer's data goes completely, and the record that an administrator deleted it does not, because a log that erases its own deletions is not one |
| Immediate deletion | Kept, behind a disclosure | Danger zone | Disclosure | Disclosure | An erasure demand with a legal deadline cannot wait 30 days. Removing the option would have traded one unusable state for another; it is simply no longer the default |
| (new) Account deletion sweep | Added | Automation Health roster | Agent | Agent | A purge nobody performs is a promise this page makes and does not keep. Its own agent rather than a branch of the retention sweep, so a customer setting retention to nought cannot accidentally disable account deletion |
| A purge that fails | Behaviour | Stays scheduled, tries next run | Sweep | Sweep | Clearing the schedule on failure would strand a deletion somebody is expecting, silently |
| Scheduled state on the account | Added | Beside the access line | Banner | Banner | It is the single most important thing about the account, so it does not live only in the danger zone at the foot of a page that scrolls |

### Invitations

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| (new) Live offer preview | Added | Beside the form | Right column | Under the form | The builder collected a plan, a period and a discount and showed none of the money. Choosing 25% off a founding annual plan meant doing the arithmetic in your head on a form whose output is a binding offer to a customer |
| Where the figures come from | Behaviour | The same catalog checkout uses | Data | Data | A preview computed a second way would be worse than none, because it would be believed. The audit log already carries a repair action for terms that were agreed and never landed |
| Free forever against free for now | Behaviour | Different readings | Preview | Preview | A free account never has an invoice; a free run is an invoice that comes later. Rendering both as "$0" would say a customer is billed nothing on a plan that in fact bills |
| The discount note on a free account | Fixed | "No checkout and no card" | Preview | Preview | Saying a discount is applied at checkout describes a step that never happens on that path |
| What it settles at | Added | "Then" line, only when it differs | Preview | Preview | Printing the same number twice reads as two different facts |
| Expiry | Added | A date | Preview | Preview | The page said a link is good for 14 days; the preview says which day that is, which is what somebody writes in an email |
| Role | Added | Preview | Preview | Preview | Named in the audit's list, and the answer carries a fact worth stating: the first person into a new account owns it |
| `INVITATION_DAYS` | Moved | The domain layer | - | - | The preview is a client component, so importing it from the admin module would pull node:crypto, the database pool and the mail transport into the browser bundle's module graph for one integer |

### Platform Admin System Health

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| (new) The whole page | Added | `/admin/health` | Seven sections | Stacked, same order | Automation Health answers whether one customer's automation is working, and answers it well. Nothing answered whether the platform was, so an outage affecting every account had to be found one organization at a time by an administrator who happened to open the right one. The platform's worst failures were the ones it was slowest to notice |
| Service definitions | Behaviour | The agents that perform them | Data | Data | A status flag has to be remembered by whoever changes the code. A run either happened or it did not |
| A service that has not run | Behaviour | "Not run", never healthy | Card | Card | The distinction the page turns on: a platform whose agents have all stopped shows no failures at all, and a table of failures is empty in both the best case and the worst |
| A platform where nothing has run | Behaviour | "Nothing has run" | Banner | Banner | Rather than "operating normally", which is what a naive reading of zero failures produces on a dead deployment |
| Services that ran clean beside services that did not run | Behaviour | Named as unproven | Banner | Banner | "No failures anywhere" is true and incomplete when four of nine services have no evidence either way |
| Incidents | Behaviour | Grouped by cause across every tenant | Cards | Cards | Grouping per organization would report one exhausted credit balance once per customer it stopped, which is the wrong shape for a reader who fixes it once. The account count is what turns a cause into a priority |
| Incident repair text | Behaviour | The same specs Automation Health uses | Data | Data | Two copies would drift, and the way anybody would find out is an administrator following the wrong instruction during an outage |
| Failure sampling | Behaviour | Capped, and the cap is stated | Cards | Cards | An outage produces thousands of identical rows. A truncated count that does not say it is truncated reads as a total |
| Queue depth | Behaviour | "Not measured" | Card | Card | The queue lives in a different backend depending on deployment and nothing here can read a depth from all of them. Reporting nought is how a growing backlog stays invisible on the page that exists to notice it. Its badge says "Not measured" rather than "Not run", which would say the queue had stopped |
| Provider capacity | Behaviour | Read from failures already classified | Card | Card | Calling the provider would cost money on a page that gets refreshed, and would answer about this second rather than the window everything else describes |
| Last refresh | Added | Under the headline | Banner | Banner | Item 1 of the spec. The page does not poll, and saying so is the difference between a stale reading and a believed one |

### Global search

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| Messages and documents | Added | Two more groups | Overlay + page | Overlay + page | They were never searched at all. Somebody looking for a line from an email, or for the scope sheet they attached last week, got nothing back and no sign that those records had simply never been looked at |
| A flat list with a badge per row | Changed | Grouped by kind, with counts | Overlay + page | Overlay + page | A badge makes the reader do the sorting: they scan nineteen rows looking for the one subcontractor among the opportunities. The counts are also what say a search matched four messages nobody thought to look in |
| Arrow-key order | Behaviour | One flat index across the groups | Overlay | Overlay | Grouping is a rendering decision and must not change what Enter opens |
| The loading state | Fixed | Rendered | Overlay | Overlay | It was computed and never shown, so a slow search displayed an empty box, which is indistinguishable from no matches and invites the wrong conclusion |
| Match highlighting | Added | Title and subtitle | Overlay + page | Overlay + page | Returned as plain segments rather than as markup: the text is a customer's own record, and this is the one path every record in the account travels to reach the screen, so there is nothing to escape because nothing is parsed |
| Message subtitles | Behaviour | A window around the match | Overlay + page | Overlay + page | The opening of a long email is its greeting. The line that matched is the reason it is in the list |
| A truncated snippet | Behaviour | Marked with an ellipsis | Overlay + page | Overlay + page | Cutting text without saying so hides that there is more |
| The no-results state | Changed | Suggestions, not a tip | Overlay + page | Overlay + page | The commonest reason for no results is looking for something that was never indexed, so the most useful correction is saying what is actually searched. Anything cleverer would guess at intent |
| (new) Recent searches | Added | Idle state of the overlay | Chips | Chips | Kept in browser storage, and every read and write is guarded: a remembered search is a convenience, and a private window should not break search |
| (new) `/search` | Added | Full results page | Grouped, filterable | Same, full screen | Somewhere for "View all results" to go, and the audit's dedicated full-screen mobile search is simply this page on a phone |
| Search queries | Moved | `lib/search`, one copy | - | - | The overlay and the page ask the same question and must get the same answer. Two copies would drift, and the way anybody would find out is a record appearing in one and not the other, which reads as data loss rather than a bug |

### Notifications

| Existing item | Decision | New location | Desktop | Mobile | Reason |
| --- | --- | --- | --- | --- | --- |
| (new) The whole surface | Added | `/settings/notifications` | Category list | Same, stacked | There was nowhere to find out what this account is told by email, and the answer turns out to be surprising enough to be worth a page |
| Eight categories | Added | The ones the audit names | Cards | Cards | Critical account alerts, automation failures, deadlines, replies, assignments, compliance, summaries, product updates |
| Toggles | Not built | - | - | - | Most of these messages are not sent to a customer at all: every digest is gated on the operations organization and one deployment-wide address. A switch that turns off something already silent is a promise the product does not keep, and the operator finds out the day the message they relied on does not arrive |
| What is actually delivered | Added | Stated per category | Cards | Cards | An operator whose subcontractor's insurance lapses on a live contract receives no email and, before this, had no way to learn that none was coming |
| Which alerts cannot be switched off | Added | With the reason | Cards | Cards | The audit asks for this explicitly. The reason is about consequence rather than policy: "you cannot turn this off" is an instruction, "a declined card nobody sees becomes an account locked mid-bid" is an explanation |
| A mandatory alert that is not delivered | Added | Its own state, in red | Card | Card | The most dangerous state on the page and the easiest to render as reassurance: "always on" beside "no email is sent" reads as a promise where it is in fact a gap |
| Assignments | Behaviour | "Not produced" | Card | Card | There is no assignee column anywhere in the schema, so nothing generates these. Calling them "in the product" would imply the information is on a page somewhere, and it is not |
| Where each alert does appear | Added | A link per category | Card | Card | If the only way to see something is to open a page, the page is worth naming |

### Knowledge Center (`/how-it-works`)

Brief section 8: "explain the platform, workflows, terminology, and recovery
steps without forcing users to contact support", with a prominent
natural-language search, a role-specific quick-start checklist, an interactive
workflow map, contextually relevant articles, a searchable glossary, and a full
reference mode; each workflow step showing current status, owner, trigger,
input, output, failure recovery, related page, and a recent example. Also
section 8's standing rule: "All user-facing platform changes must update the
relevant Knowledge Center guidance. Do not allow instructions to become stale."

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| "About every 2 hours, new federal opportunities are pulled from SAM.gov" | Wrong | Read from the registry | Step 3 | Step 3 | The registry had been scheduling that agent every three hours for months. The sentence was true when it was typed and had no reason to stay true, and nothing in the repository would have noticed. Same claim, same staleness, in three other places: the integration description on the setup checklist, the empty-pipeline banner, and the trial-key reasoning |
| "A polite follow-up goes out after about 48 hours" | Wrong for any account that changed it | This account's own follow-up rule | Step 9 | Step 9 | The window became an operator setting between 1 and 720 hours. An operator who set it to 24 was reading documentation about somebody else's account. The same sentence was in the Content Library beside the follow-up template |
| Cadences and limits | Typed into prose | Generated from the registry and the account's rules | Every step | Every step | Prose cannot be wrong loudly. A cadence stated anywhere other than the registry is a copy, and a copy of a number nothing checks drifts |
| A cadence in any page or component | Allowed | A test failure | - | - | `tests/agent-cadence.test.ts` scans `app`, `components` and `lib` for a hardcoded run frequency and fails on one. The registry is the single file allowed to write one down |
| Search | Not on the page | Ranked across steps, glossary and page help | Form + results | Form + results | The page had no search at all, which for a reference page means reading all sixteen steps to find one |
| A question typed as a sentence | - | Answered, or answered partially and said so | Results | Results | Requiring every word returned nothing for "why did nothing get emailed", which is exactly the phrasing the search box invites. It now falls back to a ranked partial match and says which it gave, because results answering half a question presented as the whole answer are worse than none |
| Current status per step | Absent | From this account's own records | Badge + sentence | Badge + sentence | The page described a pipeline in general and dodged "is that happening to me", which is the question the reader arrived with. Silence is not health: a step that has never run reads "Nothing yet", a step whose records could not be read reads "Not recorded", and neither is allowed to look like a step that is working |
| "Waiting on you" counts | - | From `queueCounts` | Badge | Badge | The same figures the sidebar badge and Today already count. Writing the predicates again here produced a second answer to "how many decisions are waiting", on a page whose job is explaining the first one |
| A recent example per step | Absent | A real record from this account | Sentence | Sentence | "90 in the last 7 days, most recently 15 hours ago. Most recent: Roof replacement." is a step you can check. A description is not |
| Trigger, input, output, recovery | Absent | Per step, behind a disclosure | `<details>` | `<details>` | The brief asks for all four. They are folded away by default because sixteen steps times six facts is a wall, and opened together by the full reference mode |
| Failure recovery | Absent | Per step, with the page that fixes it | `<details>` | `<details>` | The stated purpose of the section is not contacting support. Every step names what to do when it does not happen and links to where |
| Full reference mode | Absent | `?full=1` | Header action | Header action | Server-rendered, so it works with no JavaScript and survives a page reload, unlike an expand-all button |
| Quick start | Absent | The setup checklist plus four first runs | Checklist | Checklist | The setup half comes from `computeSetupChecklist`, which is what Today shows. Two answers to "is setup finished" is one more than the number that can be right |
| Role specificity | Absent | Capability-filtered, never hidden | Checklist | Checklist | A step the reader's role cannot perform is shown with who can. Hiding it gives a read-only account a checklist that looks finished and an operator who never learns the step exists |
| Glossary | Tooltips only | Listed, searchable, linkable | Two columns | One column | Thirty definitions existed and could only be found by hovering the right word on the right page. A term you have to already know where to find is not a glossary |
| The calling step when calling is off | Shown as a normal step | "Turned off", with what happens instead | Step 10 | Step 10 | An email-only account was being told to make calls that no card is ever prepared for |
| The header count | - | "1 step needs you" | Header | Header | "8 waiting on you" beside a page about the workflow reads as eight steps. The per-step detail carries the real counts |
| The honest note on bid packages | Kept | Kept | Callout | Callout | It is the most important sentence on the page and none of this changes it |

### Guide Me (`/api/guide`, `/api/guide/pulse`, `/api/guide/ask`)

Audited to the same standard as the Knowledge Center: no invented facts, no
number typed into prose that the code can change underneath it, and honest
states when something is absent.

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| "Connect your Google inbox" | Marked done for every account | Done only when a mailbox is connected | Checklist | Checklist | It read `integrationStatus().gmail`, which is whether the PLATFORM holds Google OAuth credentials. That is one fact shared by every customer on the deployment, so a brand-new account was told the step was finished while no inbox was connected and no outreach could send. "Connected" has to mean the thing works |
| A deployment with no Google credentials at all | Silently done | Outstanding, with the reason | Checklist | Checklist | The step is impossible rather than undone, and an operator can spend a long time looking for a button that is not there |
| Setup progress | Four callers, three answers | `accountSetup`, one caller's worth | Panel + Today | Panel + Today | Today mixed the deployment's keys with the customer's own and passed the trial flag; both Guide Me routes read the environment alone and passed neither. On a trial account with its own SAM key, Today said a step was done and the panel beside it said it was outstanding, and marked two borrowed credentials "Required" |
| The facts behind an answer | Posted by the browser | Rebuilt server-side from the path | Q&A | Q&A | A guide supplied by the client is grounded in whatever the client says, and in whatever was true when the panel loaded, which on a page left open all morning is not now. The endpoint's whole promise is that the answer comes from the account's real state |
| The path the answer is built from | - | Same-origin app paths only | Q&A | Q&A | It selects which of the account's records are read, so it must not be able to name anything else |
| Conversation history | Six turns, unbounded length | Six turns, 2000 characters each | Q&A | Q&A | `slice(-6)` bounded how many turns reached the model, not how long each was, so a client could post six megabyte strings and have them billed as input tokens |
| Setup capability gating on the quick start | Keyed `gmail` | Keyed `email` | Checklist | Checklist | The checklist calls that item "email". Keyed wrong it fell through to no capability at all, so a read-only account was told to connect an inbox it cannot connect. `tests/knowledge.test.ts` now asserts every checklist key is covered |

### Your account (`/settings/account`)

Brief section 8's last page group: the authentication and account screens
(personal details, role, security, connected sessions, time zone, accessibility
preferences, display density).

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| A screen for the person | Did not exist | Built | Page | Page | Every settings page was the company's: the profile, the rules, the templates, the integrations, the bill. There was nowhere at all for the person using them |
| Changing your own password | Only by email reset | From inside the session | Form | Form | The only route was declaring you had lost it, waiting for mail, and being signed out of every device. It also left somebody who suspected their password was known depending on the mailbox most likely to be compromised alongside it. The current password is required, so a borrowed unlocked laptop is a session to end rather than a permanent takeover |
| What a password change ends | Every session | Every session but this one | - | - | The reset link proves control of a mailbox, so ending everything is right there. Here you proved you know the old password from inside a live session, and signing you out of the device in your hand punishes the good case |
| Connected sessions | No such thing | Every live session, with device and last use | List | List | A session row carried a token, a user and two timestamps, so "where am I signed in" had no answer and the only safe move on suspicion was a reset that signed out the devices you wanted to keep |
| The device name | - | "Chrome on macOS", or "Not recorded" | List | List | Recognition, not fingerprinting. Deliberately no IP address: it would add a rough location and a durable identifier to every request, and the question here is "is that my laptop" |
| A session with no user agent | - | "Not recorded" | List | List | Rows predating the column have none. Substituting the sign-in time for a missing last-seen would claim activity that was never recorded, on the one screen somebody reads when they suspect their account has been used |
| Ending someone else's session | - | Scoped inside the delete | - | - | A session id is a bearer token. A delete that trusts an id from the body would let anyone signed in end anyone else's session by guessing one |
| "Signed out" for a session already gone | - | 404 with the reason | List | List | Reporting success either way teaches somebody the button works when it did nothing |
| What your role permits | Discovered on refusal | Both halves, listed | Two columns | Stacked | Listing only what you hold answers "what can I do" and leaves "why was I refused" to the moment of refusal, which is the expensive way to learn it. Each thing you cannot do names who can |
| Time zone | - | Named as absent, with what is used instead | Card | Card | Nothing in the product reads a stored time zone yet. A control that changes nothing is worse than its absence, so the page says what actually governs each clock |
| Display density | - | Pointed at, not duplicated | Card | Card | Density is already per table and already remembered. A second control here would be a second answer, and the two would disagree the first time somebody used the other |
| The accessibility sweep's route list | 16 routes | 26, and a test that keeps it whole | - | - | It printed "0 findings" while seven operator pages were not in the list at all. Adding them found fourteen touch targets under 44px on the platform accounts table: the density buttons at 24px, every sortable column header at 13px, and the row links at 36px. A zero that covers less than the product is worse than a number nobody trusts, because this one does get trusted |
| Table sort headers and density buttons | Under 44px on a phone | Thumb-sized on mobile, unchanged above it | Table | Table | Sorting is exactly what somebody does on a small screen to make a wide table usable |

### The signed-out screens, and the sweep that never saw them

The accessibility sweep signed in before it started measuring, so the pages a
customer meets before they have an account had never been checked at all. It
now runs a signed-out pass first, in a context that has never held a session
cookie.

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| The sign-in form's two inputs | No accessible name | Labelled | Form | Form | "Email" and "Password" rendered above them and were tied to nothing, so a screen reader announced two blank text boxes on the page every customer has to pass through. Correct to anyone who could see it, and the sweep signed in THROUGH this form without ever measuring it |
| The first-run setup form | Four labels, none associated | Labelled | Form | Form | Same defect, on the screen that creates the first account on a deployment |
| Nine more bare labels | Across the operator UI | Labelled | Forms | Forms | Scoring thresholds, the content library's four fields, the template editor's subject and body, and the integration credential field. Two of them had an aria-label duplicating the visible text, which named the field for a screen reader and left clicking the label doing nothing |
| A bare label shipping again | Possible | A failing test | - | - | `tests/input-labels.test.ts` catches it in source, including on the three screens the sweep cannot reach without a live token or a fresh install |
| Contrast measurement | Ancestor walk | What is actually painted | - | - | The walk reported the marketing navigation at 1.05:1, near-invisible, for light text sitting legibly on a dark hero: the header is positioned over that hero rather than inside it, so walking up the DOM missed it and landed on the cream page background. A confident wrong number is worse than no check, because it sends somebody to fix a page that is correct |
| Contrast on screen-reader-only text | Reported as a failure | Excluded | - | - | The `.sr-only` pattern is a 1px box clipped to nothing, which passes every other visibility test. Asking what colour invisible text is against has no answer |
| Marketing footer, navigation and hero links | 14 to 28px tall on a phone | 44px on a phone, unchanged above it | Links | Links | These are the first things a customer touches, and several were a coin toss under a thumb |
| The video's only stop control | 36px | 44px | Button | Button | It sits over a playing video and is the only way to stop it |
| A `<label>` and an `<h3>` inside the marketing mock | Form control and document heading | Inline elements | Mock | Mock | The mock is a picture of the product. Its caption was a form label attached to no control, and its title was an h3 directly under the page h1, which is a skipped level for anyone navigating by headings |
| The sweep's own sign-in | Drove the form | Calls the API | - | - | Once the signed-out pass runs first, a click can land before hydration and be swallowed, which the sweep reported as a broken sign-in on a form that works. The form is measured in the signed-out pass, so nothing is lost |

### Context preservation (brief section 12)

"Remembered filters, sorting, density, columns, view, and scroll position."

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| Filters and sort | In the URL only | Remembered per page | List pages | List pages | An operator who narrowed the list to the three agencies they work with, opened a record, and came back through the sidebar was handed everything again and set it all a second time. The URL held the view only for as long as they stayed on it |
| The pipeline's view | In the URL only | Remembered with its filters | Header | Header | Its three views are a real choice, and the filter bar could not remember it: the bar is only mounted in one of the three, so leaving the table and coming back dropped them into the lanes board with their filters gone |
| A restored view | - | Says so, with the way out | One line | One line | A filtered list somebody did not filter is the "why is this empty" trap arrived at from a new direction. The line names what happened and puts Start fresh beside it |
| "Clear all" and "Start fresh" | - | Forget before they navigate | Controls | Controls | Both land on the bare path, which is exactly what a restore acts on. Without the forget they would be undone on arrival, which is a control that appears not to work: you press it, the page reloads, and nothing has changed |
| A view arrived at by link or bookmark | - | Remembered | - | - | The first render deliberately writes nothing, so a bare arrival cannot erase the memory before the restore reads it. Applied to every first render, that skipped real arrivals too, because a full page load remounts the component: a bookmark to the filtered table was forgotten the moment somebody left it |
| An explicit query | - | Wins over the memory | - | - | Anything with parameters was asked for by whoever followed the link, including a deliberately unfiltered one. Replacing that would override an explicit request with a remembered one |
| The quick-look drawer | - | Never remembered | - | - | What is stored is rebuilt from the parsed filters, sort and page size rather than copied off the address bar, so a page-local parameter cannot be stored and reopened days later on a record somebody has moved on from |
| Density and columns | Already remembered | Unchanged | Per table | Per table | Kept per page on the table itself: comfortable rows suit the opportunity list and compact ones suit the email log, and one switch for both would be wrong on one of them |
| Scroll position | Router default | Unchanged | - | - | The App Router restores scroll on Back, which is the case that matters: returning to a long list from a record. A forward navigation from the sidebar starts at the top, which is right |

### Error prevention (brief section 11)

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| Leaving a half-filled company profile | Silently discarded | Asks first | Prompt | Prompt | The page installed the browser's unload prompt, which fires when the tab closes and never for an in-app navigation. Clicking Today in the sidebar threw the form away with nothing on screen, and that is how people actually leave a page |
| The template editor, automation rules, content library and call workspace | No guard at all | Guarded | Prompt | Prompt | Notes taken during a call and a price somebody read out are the worst of these to lose: the subcontractor has hung up, and asking again means another call |
| Which state counts as unsaved | - | Compared against what was loaded | - | - | Derived rather than tracked with a flag, so a save clears it without anything having to remember to, and a flag left set cannot warn about a form nobody touched |
| Clicks the guard must ignore | - | Modified clicks, new tabs, downloads, external links, same-page navigation | - | - | A document-level interceptor that catches too much breaks ordinary navigation, which is worse than the problem it solves. Verified in a browser: a clean page leaves silently, and in-page tabs are untouched |
| The browser Back button | Unguarded | Unguarded, and said so | - | - | Guarding it means pushing a sentinel history entry and unwinding it, which goes wrong in ways that trap somebody on a page they are trying to leave. A missing guard costs an edit; a broken one costs the exit |
| Recording a bid as submitted | No confirmation | Confirmed, and the confirmation says what it does | Prompt | Prompt | The override path has always confirmed and the ordinary one, which is the one everybody uses, did not. Pressing it does not send anything to the agency: it records that you did. A bid marked delivered that nobody uploaded is the product asserting something that did not happen |
| A new editor shipping unguarded | Possible | A failing test | - | - | `tests/unsaved-guard.test.ts` lists the editors deliberately, because "is there unsaved work here" is a judgement about what a form holds rather than something a scan can decide. Adding one means making that decision on purpose |

### Mobile completion (brief section 13)

"Every workflow must be completable on a phone." Walked at 390 by 844, an
iPhone 13, on the built production server rather than in dev.

| Item | Before | After | Desktop | Mobile | Why |
| --- | --- | --- | --- | --- | --- |
| The call workspace | Never measured | Measured, and six targets fixed | Unchanged | 44px | The accessibility sweep reported no findings for this page for as long as it has existed, because the page only renders when the account has a call waiting. The seeded account has none, so the sweep signed in, found an empty queue, measured the empty state, and counted it as covered |
| The yes/no and choice answers | 165 by 36 | 44 tall on a phone | Unchanged | 44px | These are pressed one-handed with a phone against an ear. At 36 a slip on a yes/no records the opposite of what was said, and the record is what later sourcing reads |
| The confidence row, one to five | 62 by 36 | 44 tall on a phone | Unchanged | 44px | Five targets side by side, filled in immediately before Complete call. A slip here rates a different subcontractor than the one on the phone |
| The close control | 27 by 38 | 44 by 44 on a phone | Unchanged | 44px | The only way out of the workspace |
| The brief toggle | 28 by 16 | 44 by 44 on a phone | Unchanged | 44px | Opens the job details mid-call. A height floor alone left it 28 wide and still a miss, because a text button is only as wide as its one-word label |
| `/review`, pursue and pass | - | Confirmed completable | - | Walked | Both decisions, the bulk bar and the brief panel, end to end on the phone |
| The opportunity record | - | Confirmed completable | - | Walked | All twelve sections reachable, no horizontal overflow at 390 |
| The subcontractor record and compliance | - | Confirmed completable | - | Walked | Same |
| The call workspace going unmeasured again | Possible | A failing test | - | - | `tests/call-touch-targets.test.ts` pins the floor in source. It is a weaker instrument than a measurement and says so: it confirms the floor is declared, not that the rendered box clears 44. Seeding a call card for the sweep would measure the real thing, and is the better fix whenever the sweep grows fixtures |

## Not changed, deliberately

- **404 rather than a permission state on `/authority` and `/admin/accounts`.**
  Naming a page confirms it exists and is worth attacking. `PermissionState`
  would weaken that, so both routes still 404 for signed-in non-admins.
- **`/pipeline` is left at ~200ms.** It renders every open opportunity as a
  draggable card, so it is linear where the others are not. Virtualizing it is
  worth doing when an account carries thousands of open opportunities, and is
  not worth the complexity before then.
- **Compliance stays a card board, not a table with a detail drawer.** The
  cards already carry every field the drawer would, and they are editable in
  place: setting a renewal date is two clicks, where a table plus drawer makes
  it four. Converting would be a lateral move that removes inline editing.
- **No owner field on a compliance item.** There is no assignee column
  anywhere in the schema, and a field that always says the same thing is worse
  than no field. Same reasoning as the attention system.
- **Recurrence, reminder policy, calendar view and bulk document upload are
  not built.** Each needs schema and a background job rather than a layout, and
  they are worth doing on their own rather than inside a page restructure.

- **The accessibility sweep still cannot reach the call workspace.** Measuring
  it needs a call card in the database, which means the sweep grows fixtures and
  a teardown, and a sweep that writes to the database it is measuring can leave
  rows behind when it fails partway. The source test is the weaker guard chosen
  deliberately over a heavier one; the gap is written down here rather than
  closed quietly.
- **The browser Back button in the call workspace is not guarded.** Same
  reasoning as everywhere else: a broken guard traps somebody on a page they are
  trying to leave. Save draft is one tap away and keeps the answers.

- **Site Authority stays admin-only.** It reports on our own marketing domain
  and means nothing to a contractor.
- **No breakdown by trade on Analytics.** Trade is a property of a
  subcontractor and of a quote, not of an opportunity, so a trade column in a
  funnel cut by opportunity would either double-count or quietly drop
  everything not yet quoted. The trade view that does mean something lives on
  the subcontractor side.
- **Analytics has no charts.** Every figure on the page is a count with a
  denominator beside it, and the funnel's bars are scaled bands rather than a
  plotted series. The audit asks mobile to avoid miniature charts and crowded
  legends; the same reasoning applies at every width when the underlying
  numbers are this small, and a bar chart of four agencies is decoration.
