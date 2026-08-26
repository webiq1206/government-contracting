# Security and tenant isolation

What is enforced, where, and the evidence that it holds. Re-runnable rather
than asserted: every claim below names a test that proves it against a real
two-tenant database.

## Layers

A request passes four gates, in this order, and each answers a different
question. They are separate on purpose: collapsing any two of them produces a
status that cannot distinguish "not signed in" from "not paid up" from "not
allowed", and an operator cannot act on an answer that vague.

| Gate | Question | Failure | Where |
| --- | --- | --- | --- |
| Authentication | Is there a valid session? | 401 | `requireUser` |
| Access | Is the account entitled to work? | 402 | `accessLevel` via `requireOrgContext` |
| Tenancy | Which organization is this? | 403 (no org) / 404 (other org's record) | `resolveTenantOrgId`, `findOrgRecord` |
| Permission | May this person do this? | 403, naming a role who can | `can()` via `requireOrgContext({ capability })` |

A record belonging to another organization returns the **same 404 as a record
that does not exist**. A 403 there would confirm to a prober that the id is
real, which is a slow enumeration oracle.

## Coverage

`tests/route-permission-coverage.test.ts` walks every route handler in the
application rather than reading a list, so a handler added later is caught the
first time the suite runs. Twenty exemptions are named individually with a
reason; a blanket pattern would quietly absorb the next mistake.

Exempt, and why: the auth handshake and first-run setup (no account exists
yet), the Stripe webhook (signature-verified, not a person), the invitation
acceptance and vendor portal (the token in the link is the credential), the
Platform Admin surface (its own `requirePlatformAdmin` guard), and three
read-shaped routes that only touch the caller's own session.

## Evidence

Run against a seeded two-tenant database:

```
DATABASE_URL=... ALLOW_TESTS_AGAINST_DATABASE_URL=1 npx vitest run \
  tests/tenant-isolation-attack.integration.test.ts \
  tests/auth-security.integration.test.ts \
  tests/vendor-portal-security.test.ts \
  tests/reply-capture-isolation.integration.test.ts \
  tests/scoring-engine-isolation.integration.test.ts \
  tests/sub-finder-isolation.integration.test.ts \
  tests/maintenance-isolation.integration.test.ts \
  tests/compliance-monitor-isolation.integration.test.ts \
  tests/learning-loop-isolation.integration.test.ts
```

**9 files, 53 tests, all passing.** They cover cross-tenant reads and writes
through the real handlers, session forgery and fixation, the vendor portal's
token surface, and each background agent staying inside the organization whose
work it is doing. The agent tests matter as much as the request ones: an agent
runs without a session, so nothing about the request path protects it.

## Permission enforcement, verified through the browser

A second user was added to the seeded organization with the `viewer` role, and
six mutating endpoints were called directly, so the interface's own hiding of
controls could not be mistaken for enforcement:

| Endpoint | Owner | Viewer |
| --- | --- | --- |
| `POST /api/automation` | 200 | 403 |
| `POST /api/automation/rules` | 200 | 403 |
| `POST /api/profile` | 200 | 403 |
| `POST /api/content` | 400 (validation) | 403 |
| `POST /api/snooze` | 400 (validation) | 403 |
| `POST /api/bulk` | 400 (validation) | 403 |

Every 403 names a role that could do it, so the next move is a conversation
rather than a support ticket.

## Deliberate

- **`/authority` and `/admin/accounts` return 404 to a signed-in non-admin,
  not a permission state.** Naming a page confirms it exists and is worth
  attacking. The friendlier screen would be a worse answer.
- **An unrecognised role reads as `viewer`.** Being wrong that way costs
  somebody asking to be let in; being wrong the other way costs a stranger
  submitting a bid.
- **`past_due` keeps access.** Stripe is retrying a declined renewal, usually
  an expired card. Cutting a deadline-driven product off there turns a card
  hiccup into a missed federal submission, and the state is bounded by Stripe
  itself: dunning ends in `unpaid` or `canceled`, neither of which grants
  access.
- **Support sessions cannot touch billing.** An admin signed in as a customer
  is the highest-privilege state in the product; checkout and the Stripe
  portal both refuse it, and the session expires in an hour.

## Known limits

- **`users.role` still exists** and is platform-level, predating multi-tenancy.
  Nothing reads it for permissions any more except the legacy fallback in
  `getOrgRoleForUser`, which exists so the founding single-tenant install --
  which has no `organization_members` rows at all -- is not demoted to
  read-only. Removing it needs a migration that backfills those rows first.
- **Per-record ownership is not modelled.** "Only the assigned estimator may
  price this bid" is a real requirement for a larger team and a bad fit for
  accounts where three people share everything; a lock would mostly lock out
  whoever is covering for someone on leave. Assignment is tracked and shown;
  it does not gate.
