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
