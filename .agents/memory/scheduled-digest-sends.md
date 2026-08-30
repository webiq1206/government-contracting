---
name: Scheduled digest sends
description: Rules learned building the morning recap mail — local send times across DST, duplicate prevention around the provider call, and why capped lists must never be counted.
---

# Resolving a local send time

A wall-clock time plus a zone is not one instant, and the offset depends on the
answer you are trying to compute. Guessing an offset and re-reading it does not
converge: on the spring-forward morning the two passes straddle the gap and the
naive result lands an hour BEFORE the missing hour, so a 6:00 send that happens
to sit near a transition goes out early once a year.

The reliable shape is candidates plus a round trip: build the candidate
instants from every offset in play, format each one back into the zone, and
keep the ones whose wall clock equals what was asked for.

- One survivor: an ordinary day.
- Two survivors (fall back): take the earliest, or the mail is an hour late.
- No survivors (spring forward): take the latest candidate, which is the
  requested time shifted past the gap.

**Why:** verified empirically in America/Denver; day windows were already
correct (23h and 25h) while the send-time helper was not, so tests that only
checked window lengths passed through the bug.

# Duplicate prevention around a provider call

A claim row is not enough. Recovering a stalled claim needs to distinguish
"the worker died before the provider was contacted" from "the worker died after
the provider accepted it", and a row that only records status cannot tell those
apart. Stamp the row immediately BEFORE handing the mail over, never after.

- No stamp: safe for automation to reclaim and send.
- Stamp present: automation stops. Surface it in the history as an outcome
  nobody knows, and let a person choose to send it again.

Also cap automatic attempts, or a permanently bad address is retried on every
scheduler tick for the whole delivery window.

**Why:** a second copy of a daily summary is the one delivery mistake that
cannot be undone, and silence is cheaper to explain than duplication.

# Capped lists are not totals

Any list rendered into a mail is capped for readability. Computing a headline
total as the length of that capped list silently misreports exactly the busy
days people check. Count separately in SQL and let the list stay short, saying
"and N more" where it is truncated.

**How to apply:** whenever a summary shows both "N things happened" and a list
of those things, the number and the list must come from different queries.
