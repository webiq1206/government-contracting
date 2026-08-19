---
name: Diagnosing a lockout
description: Why "invalid password" is weak evidence about the password, when a guard should ignore rather than refuse, and what an honest delivery signal may be derived from.
---

# A rejected password is not evidence about the password

Before investigating credentials, confirm the site can read its own users. If the database
is unreachable, no password works for anyone and the login form is lying about the reason.

**Why:** an auth route that catches every exception and returns "Invalid email or
password" makes an outage indistinguishable from a wrong password. Every diagnosis then
starts from the credential (verifying the hash, counting characters, blaming autofill),
and all of it can be consistent with the evidence and still wrong.

**How to apply:** keep "the password was rejected" and "the check could not run" apart in
any catch around authentication, answer the second with a service error, and never count
it toward a brute-force lockout.

# A guard that fails closed in production can be worse than the risk

An environment flag that is meaningless in a deployment should be ignored there, loudly,
not treated as a reason to refuse to start.

**Why:** refusing to boot on a leaked development flag took the whole live site down,
while the outcome it guarded against (serving from the wrong database) was not reachable
in that environment anyway, because a deployment already carries the real connection
string.

**How to apply:** ask whether the bad outcome is even possible in the environment being
guarded. If the correct behavior is unambiguous, take it and warn; reserve refusal for
continuing that would corrupt or expose something. Then check every consumer of the flag,
not just the obvious one: the same flag also gated outbound email, so left unread it
would have silently stopped real mail on a site that otherwise looked healthy.

# An honest "we sent it" may only be derived from facts about us

Telling someone a reset link is on its way when nothing was sent leaves them waiting on
nothing, and it is the last way back into an account. But the fix cannot be to report the
outcome of the send.

**Why:** a send only happens for an address that has an account. Any signal derived from
it (including a short-lived "recently failed" flag) answers differently for an address
with an account than for one without, in some request ordering. That is account
enumeration on the password-reset endpoint.

**How to apply:** derive the visible answer only from state established before the account
lookup, and only from state that is a property of the sender: is the transport connected,
and does its stored health say a real call already failed. Per-recipient send outcomes are
logged, never returned. Deciding it before the lookup has a second payoff: it still works
when the database is the thing that is down. Every other no-send path (throttled caller,
failed request) must return the same answer, and the client should treat anything that
does not explicitly say "sent" as not sent.
