---
name: Queue job payloads, trust and dead records
description: A job payload never establishes tenant identity, and a job whose record was deleted is finished rather than failing.
---

# A payload never establishes which tenant a job belongs to

The manual-run endpoint hands a request body to the runner, and the runner
decides from that payload which organization the job runs as. So a job payload
is an authority document written by the caller.

**Why:** naming another organization, or merely naming one of its records, was
enough to have an agent read, write, bill and log across the tenant boundary.
A record id looks like data, but in this system it selects a tenant.

**How to apply:** tenant identity may come from a record the caller is proven
to own, or from a channel the queue itself writes. Never from a payload field.
When adding anything to a payload that could influence which organization work
runs as, assume the endpoint above it is public and reachable by any customer.

The ordering that holds today: a live named record decides, and only when no
record answers does the queue's own stamp apply.

# A job whose record is gone is finished, not failing

Records are deleted while jobs about them sit in the queue (the expiry sweep
does this routinely). Retry policy is for transient trouble, so a missing
record is a permanent outcome and the worker must not retry it.

**Why:** treating it as an ordinary failure costs three attempts with backoff
per dead record, forever, and tells the operator nothing.

**How to apply:** decide it once, centrally, in the same lookup that resolves
the tenant, so every agent inherits it and a new one gets it without knowing to
ask. Everything else stays retryable, which is what keeps a rate limit or a
database blip recoverable.

# The log line about a deleted record must still be writable

`agent_logs` points at other tables with foreign keys, so a line about a
deleted record is rejected and lost.

**Why:** the moment the explanation matters most is the moment the record is
gone, so the reason to write the line is the same reason it fails.

**How to apply:** drop only the one link the database named, keep the id in the
message, retry. Never blank columns until a row inserts: a constraint failure
you did not expect must stay visible rather than be filed as a half-true row.
