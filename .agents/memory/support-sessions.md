---
name: Support sessions (signing in as a customer)
description: How impersonation is modelled, and the rule that its guarantees must hold at every sink rather than the obvious one.
---

# Signing in as a customer

An impersonated session is a **real session row for the target user**, marked
with the admin's email and their original session id so "return to admin" can
restore it. The marker lives on the session row, not in a second cookie.

**Why:** a second cookie is a second thing that can be dropped, forged, or get
out of step with the session it describes. One row means the marker cannot
outlive or contradict the session.

**How to apply:** the route that *ends* a support session must not be
admin-gated. The session it is trying to leave is not an admin session, so
gating it would trap the admin inside the customer's account. Possession of
the marked session token is the authorization.

## Platform admin is an env allowlist, never a database role

Nothing that happens inside the product (a signup, an invite, a compromised
org owner, a `users.role` set by hand) can grant platform admin. The admin
area answers **404, not 403**, so its existence is not advertised.

An impersonated session is refused by the admin guard even when the
impersonating admin is on the allowlist. That refusal is also what makes
nested impersonation impossible, since starting one requires the guard to pass.

## The guarantees hold at every sink, or they are not guarantees

Two bypasses were found in review, both the same shape: a *second* path that
did not go through the guarded one.

- A second outbound-mail module called the Gmail client directly instead of
  the guarded transport.
- A second Stripe route mutated a subscription without asking about
  impersonation.

Neither was visible from the guarded code.

**Why it matters concretely:** the failure is not malice. It is an admin
reproducing a customer's bug, clicking Send, and a real third party receiving
real mail from a company that did not send it. There is no undo.

**How to apply:** when adding an outbound-mail sink or a route that moves
money, add the check. Source-sweep tests enforce this; if one fails, add the
guard rather than widening the sweep's exclusions. Guards belong at the **top**
of the function, before any read, so a test can prove they fired first.

Outside a request scope the impersonation lookup returns "nobody", so the
background worker is unaffected. That has to stay true or scheduled sending
stops.

## System mail is deliberately not blocked

Mail that addresses the account holder themselves (password resets, trial
notices) is not gated on impersonation. Only mail to the outside world is.
