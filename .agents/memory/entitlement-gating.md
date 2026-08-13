---
name: Entitlement gating and billing exemption
description: Why access is computed from one helper, why "comped" is its own column, and the gates that keep drifting out of sync.
---

# One gate, computed, never stored

Access is derived from the organization row, never read off a status string.
Precedence is fixed: **suspended beats everything, then a billing exemption,
then subscription status and trial date.**

**Why:** the organization that runs this business has never paid itself, so
Stripe reports its subscription as cancelled. Every gate that trusted
`subscription_status` alone locked the owner out of his own product. Judging a
cardless trial by its stored status has the same failure mode: when the hourly
sweep is late, a lapsed trial keeps working, and an expired one that was never
swept keeps working forever.

**How to apply:** anything deciding "can this account do things" goes through
the single entitlement helper. Do not add a second helper, and do not inline a
`subscription_status in (...)` test.

## The exemption is a column, not a status

A comp is a first-class column on the organization, deliberately **not** a
value of `subscription_status` and deliberately **not** in the set of columns
the Stripe webhook is allowed to write.

**Why:** Stripe owns `subscription_status` and overwrites it on every webhook.
A "comped" status would survive exactly until the next event and then vanish
silently, taking the owner's access with it.

**How to apply:** when adding a billing field, decide first whether Stripe or
we own it. If we own it, keep it out of the webhook's writable column list.

## The gate that always drifts is the background one

The UI gates and the *worker's* "which organizations are live" query are two
different code paths, and they drift. When they did, the comped organization
passed every check in the app and was silently skipped by scheduled
opportunity ingestion. It does not present as an access problem, it presents
as "the product stopped finding anything".

**How to apply:** after changing access rules, grep for org-selection queries
in the agents and confirm they express the same precedence. There is a test
pinning this parity; keep it.

## Do not let the admin tools eat their owner

Cross-tenant admin actions refuse to uncomp, suspend, or delete our own
account, identified by a **platform-admin owning** the organization (owner
role, not mere membership).

**Why:** any of those three would lock us out of the tooling needed to undo
them, leaving hand-written SQL against production as the only way back.
Keying on membership instead of ownership would quietly make real customer
accounts unsuspendable whenever an admin was added to help with something.
