---
name: Telling a dead worker from an idle one
description: Why liveness is a heartbeat with a phase, not the newest job row.
---

"Is the automation engine running?" was answered from the newest job run, which
collapses three different situations into one old timestamp: the process is
gone, the process is alive but never finished starting, and the process is
perfectly fine with nothing due. The owner was told "not running, use a Reserved
VM" for a night when the deployment was already correct and the boot was stuck.

Liveness is therefore a heartbeat row the worker writes on its own timer,
carrying the phase it is in, and it is platform-wide (one row, constant key)
because one worker moves every tenant's records. Fresh plus "ready" is healthy;
fresh plus any other phase is a stuck boot with the step named; stale or missing
is gone.

**Why:** the fix for each of those three is different, and naming the wrong one
sends the owner to change settings that were never the problem.

**How to apply:** keep the heartbeat write independent of the work being
measured, and let the reader degrade to the old job-log reading when no
heartbeat exists, so a deployment on an older schema still renders.
