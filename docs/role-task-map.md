# Roles and the work they own

The six roles, what each one does most, and what each one must not touch.
The capability column is enforced: see `lib/domain/roles.ts` and
`tests/roles.test.ts`.

## The roles

| Role | Stored as | In one line |
| --- | --- | --- |
| Account owner | `owner` | Everything, including billing and removing people |
| Administrator | `admin` | Everything except billing |
| Bid manager | `operator` / `estimator` | Runs bids end to end. Cannot change account settings |
| Team member | `member` | Works opportunities and subcontractors. Cannot price or submit |
| Read-only | `viewer` | Reads everything, changes nothing |
| Platform admin | by email, outside the org | Ours, not a customer role |

`operator` and `estimator` are one role wearing two names: `operator` is the
stored value and predates multi-tenancy, `estimator` is what the people doing
the job call themselves. Renaming the column would have meant a migration whose
only effect was vocabulary, and a window where live sessions carried a value the
code no longer knew.

## What each role does most

| Role | Most frequent work | Decisions they own | Ideal desktop home | Ideal mobile home |
| --- | --- | --- | --- | --- |
| Account owner | Reviewing the pipeline, approving pricing, watching spend | Pursue or pass, final price, submit, who is on the team | Today | Today |
| Administrator | Keeping the account healthy: rules, templates, integrations | How automation behaves, who is on the team | Today, then Automation Health | Today |
| Bid manager | Working one bid from decision to submission | Pursue or pass, which subcontractors, the price, submit | Today | Today |
| Team member | Chasing subcontractors, keeping records straight | Which firms to contact, what a reply means | Call Queue | Call Queue |
| Read-only | Looking things up | None | Opportunities | Opportunities |
| Platform admin | Supporting accounts | Access, billing corrections, suspension | Platform Admin, Accounts | Accounts |

## The two lines that matter

**Between a team member and a bid manager** sit `price` and `submit`. Those are
the two actions that commit money and commit the company, and they need someone
who owns the number.

**Between a bid manager and an administrator** sit the settings that govern how
everyone's work behaves: automation rules, integrations, the company profile,
the team. That is where the damage stops being one bid and starts being the
account.

## Capabilities

| Capability | Owner | Admin | Bid manager | Member | Read-only |
| --- | :-: | :-: | :-: | :-: | :-: |
| View everything | x | x | x | x | x |
| Pursue or pass | x | x | x | x | |
| Contact subcontractors | x | x | x | x | |
| Change pricing | x | x | x | | |
| Submit bids | x | x | x | | |
| Subcontractor records | x | x | x | x | |
| Compliance items | x | x | x | x | |
| Contracts | x | x | x | | |
| Run agents by hand | x | x | x | | |
| Automation rules | x | x | | | |
| Email templates | x | x | | | |
| Integrations | x | x | | | |
| Company profile | x | x | | | |
| People and roles | x | x | | | |
| Pause automation | x | x | | | |
| Delete records | x | x | | | |
| Billing | x | | | | |

## When a control is unavailable

It is not shown, and where its absence would itself be confusing -- a settings
page with no Save button reads as broken, not as read-only -- a banner says so
and names a role who can change it. The API refuses the request either way; the
interface exists so nobody fills in a form that was never going to be accepted.
