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

## Not changed, deliberately

- **404 rather than a permission state on `/authority` and `/admin/accounts`.**
  Naming a page confirms it exists and is worth attacking. `PermissionState`
  would weaken that, so both routes still 404 for signed-in non-admins.
- **`/pipeline` is left at ~200ms.** It renders every open opportunity as a
  draggable card, so it is linear where the others are not. Virtualizing it is
  worth doing when an account carries thousands of open opportunities, and is
  not worth the complexity before then.
- **Site Authority stays admin-only.** It reports on our own marketing domain
  and means nothing to a contractor.
