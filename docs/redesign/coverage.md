# Route and state coverage

The repository contains 58 page routes excluding theme QA, including 44 dashboard/account entries. Five application entries are compatibility redirects. An HTTP render confirms server behavior for the tested fixture state; it does not certify usability or every modal/tab. The portable review includes 48 content/public screens.

Every route below receives the shared theme where it uses the existing interface components. "Shared refresh" means its existing feature structure remains. Individual master-brief requirements still need interactive acceptance. All local live-application interaction checks remain pending CI because the managed preview client bundles were mismatched.

| Route | Tested role/state | Implementation disposition | HTTP / redirect | Portable static screen |
| --- | --- | --- | --- | --- |
| `/settings/account` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/settings/billing` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/settings/notifications` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/activity` | Fixture owner; platform admin on admin routes | Initial authorized ledger data server-rendered; filter/recovery behavior retained | 200 | Included |
| `/admin/accounts/[id]` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/admin/accounts` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/admin/api-usage` | Fixture owner; platform admin on admin routes | AI usage naming; financial behavior retained | 200 | Included |
| `/admin/audit` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/admin/billing` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/admin/health` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/admin/invitations` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/admin` | Fixture owner; platform admin on admin routes | Compatibility entry retained; no duplicate content screen | 200 → /admin/accounts | Not included; state explained in this row |
| `/admin/recap` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/agents` | Fixture owner; platform admin on admin routes | Automation naming; shared health/incident presentation | 200 | Included |
| `/analytics` | Fixture owner; platform admin on admin routes | Reports naming; compact explanation with optional formulas | 200 | Included |
| `/authority` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/automation` | Fixture owner; platform admin on admin routes | Compatibility entry retained; no duplicate content screen | 200 → /agents | Not included; state explained in this row |
| `/call-queue` | Fixture owner; platform admin on admin routes | Calls naming; full-screen phone call workspace and one bottom layer | 200 | Included |
| `/communications` | Fixture owner; platform admin on admin routes | Inbox naming; shared panes and controls | 200 | Included |
| `/compliance` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/contracts/[id]` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/contracts` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/email-log` | Fixture owner; platform admin on admin routes | Compatibility entry retained; no duplicate content screen | 200 → /communications | Not included; state explained in this row |
| `/feedback` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/how-it-works` | Fixture owner; platform admin on admin routes | Help center naming; shared readable content | 200 | Included |
| `/more` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/opportunities` | Fixture owner; platform admin on admin routes | Compatibility entry retained; no duplicate content screen | 200 → /pipeline | Not included; state explained in this row |
| `/opportunity/[id]` | Fixture owner; platform admin on admin routes | Clear identity and next action; consolidated readiness; optional pursuit controls | 200 | Included |
| `/opportunity/[id]/requirements` | Fixture owner; platform admin on admin routes | Shared focus mode and readable controls; source/editor behavior retained | 200 | Included |
| `/pipeline` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/recap` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/review` | Fixture owner; platform admin on admin routes | Shared decision workspace sizing and contextual mobile behavior | 200 | Included |
| `/search` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/settings/api-usage` | Fixture owner; platform admin on admin routes | AI usage naming; shared presentation and spending controls retained | 200 | Included |
| `/settings/content` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/settings/integrations` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/settings` | Fixture owner; platform admin on admin routes | Compatibility entry retained; no duplicate content screen | 200 → /settings/profile | Not included; state explained in this row |
| `/settings/profile` | Fixture owner; platform admin on admin routes | Conditional persistent save; mobile settings navigation | 200 | Included |
| `/settings/recap` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/settings/rules` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/subs/[id]` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/subs` | Fixture owner; platform admin on admin routes | Shared refresh; existing workflow structure retained | 200 | Included |
| `/today` | Fixture owner; platform admin on admin routes | Compact queue-first hierarchy; optional setup, pulse and repeated task sections | 200 | Included |
| `/workbench` | Fixture owner; platform admin on admin routes | My Work naming; queue/detail/context and mobile footer behavior | 200 | Included |
| `/compare` | Visitor / public state | Shared refresh; existing workflow structure retained | 200 | Included |
| `/pricing-guide` | Visitor / public state | Shared refresh; existing workflow structure retained | 200 | Included |
| `/privacy` | Visitor / public state | Shared refresh; existing workflow structure retained | 200 | Included |
| `/sitemap` | Visitor / public state | Shared refresh; existing workflow structure retained | 200 | Included |
| `/terms` | Visitor / public state | Shared refresh; existing workflow structure retained | 200 | Included |
| `/billing/success` | Signed-in fixture; no real checkout performed | Shared refresh; existing workflow structure retained | 200 | Not included; state explained in this row |
| `/forgot-password` | Visitor / public state | Shared refresh; existing workflow structure retained | 200 | Included |
| `/invite` | Missing-token state | Shared refresh; existing workflow structure retained | 200 | Not included; state explained in this row |
| `/login` | Visitor / public state | Clear heading/copy and sign-in card | 200 | Included |
| `/` | Visitor / public state | Rebuilt sales story, workflow gallery, pricing/FAQ and seven preview players | 200 | Included |
| `/reset-password` | Missing-token state | Shared refresh; existing workflow structure retained | 200 | Not included; state explained in this row |
| `/setup` | Visitor; existing operator redirects to login | Shared refresh; existing workflow structure retained | 200 → /login | Not included; state explained in this row |
| `/signup` | Visitor / public state | Clear trial introduction; original signup and terms retained | 200 | Included |
| `/vendor/[token]` | Synthetic valid vendor token; raw HTML not retained | Shared refresh; existing workflow structure retained | 200 | Not included; state explained in this row |

## Interaction and state coverage

| Surface / behavior | Available evidence | Open acceptance |
| --- | --- | --- |
| Shared menus, filters, quick views, tabs and dialogs | Existing regression scripts retained; navigation selectors updated; disclosure unit test added | Hydrated keyboard, Escape, focus return, browser history and drawer isolation |
| Profile and other editor drafts | Existing unsaved guard retained; mobile settings selection uses guarded links; CI scenario added | Failed save, cancellation, reload, cross-section navigation and restored draft in a live page |
| Opportunity next step and long titles | Static desktop and 320px dark layout inspected; actions wrap within record | Pursue/pass, confirmation, auto-dismiss timing, role denial and result state |
| Call workspace | Responsive layer changes and call/recovery tests | Open, retry, close, keyboard, outcome, interrupted network and next-task flow |
| Activity | Authorized server preload; existing filtering/storage recovery tests | Search, Back/Forward, export, stale/error/empty states, result details and save views |
| Settings/admin/billing | Server fixture renders and shared responsive controls | All authorized and denied actions; actual charge reconciliation and provider test-mode flows |
| Public conversion/media | Responsive static landing review; MP4 duration/codec and main native playback verified | Hydrated gallery/menu, form errors, mobile media/caption/seek/failure cases and analytics |
| First-run setup, invite and reset variants | Redirect/missing-token renders only | Fresh-deployment setup and valid/expired/used token states |
| Not-found, unauthorized and errors | Existing boundaries retained; unit tests where present | Full route/state visual and keyboard review |
| Emails and documents | Shared palette refresh; 25 relevant email/document tests passed | Representative long output rendering and email-client checks |

## Responsive evidence

Static samples cover core queues, records, settings and administrative patterns at desktop and phone widths, plus representative tablet and dark-mode inspection. The review supports five widths. This is not an every-route/every-width interactive audit. Screenshot dimensions, role and source context are recorded in `evidence/screenshot-manifest.json`. The screenshots are after-state samples; no controlled before/after performance or usability claim is made.

See [release-gates.md](release-gates.md) for the remaining device, workflow, media and performance matrix.
