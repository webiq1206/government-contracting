---
name: Worker boot that hangs instead of failing
description: Why every boot step is narrated, timed and bounded, and why no query may wait forever.
---

A deployed worker once printed its first two startup lines and then produced
nothing for eight hours. It had not crashed: the web half of the same process
kept serving, no exit line was logged, and the database showed no connection
from it at all. It was parked on a single `await` that never settled, the shape
a pooled Postgres connection takes when its socket dies mid-query.

**Rules that came out of it**

- No query may wait forever. The shared pool sets both `query_timeout` (client
  side, the only thing that fires when the socket is dead) and
  `statement_timeout` (server side). Migrations get a longer budget on their own
  standalone connection plus a `lock_timeout`, so a slow migration is not cut
  off and a blocked one still ends.
- Boot narrates itself. Every step logs before it runs, reports its duration,
  and has a ceiling. Silence between two named steps is then a diagnosis rather
  than a mystery.
- A start that failed must not be cached. The queue singleton was assigned
  before its `start()` was awaited, so a failed start was served to every later
  caller and no retry was possible. Publish a singleton only after it works.
- The connection the process cannot work without is retried forever with
  backoff, dropping the half-started object between attempts.

**Why:** the only evidence a wedged process leaves is what it logged before it
wedged, and an unbounded await leaves nothing.

**How to apply:** any long-lived process that boots against the network. Also
beware log collectors sampling bursts: fifty identical lines emitted in the same
millisecond are how the two survivors ended up misleading. Print a summary, not
one line per item.
