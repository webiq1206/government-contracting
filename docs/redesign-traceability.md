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

- **Site Authority stays admin-only.** It reports on our own marketing domain
  and means nothing to a contractor.
