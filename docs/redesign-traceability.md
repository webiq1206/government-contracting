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
| 3. Roles, permissions, terminology, task model | In progress. Roles and permissions done; terminology library still to write |
| 4. Navigation and shared design system | Partly done: sections and shared page framework landed earlier; the design system is not yet written down |
| 5. Desktop and mobile shells | Partly done |
| 6-9. Page-by-page | Partly done |
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

## Not changed, deliberately

- **404 rather than a permission state on `/authority` and `/admin/accounts`.**
  Naming a page confirms it exists and is worth attacking. `PermissionState`
  would weaken that, so both routes still 404 for signed-in non-admins.
- **Site Authority stays admin-only.** It reports on our own marketing domain
  and means nothing to a contractor.
