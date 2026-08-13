---
name: ai-drafts-for-humans
description: Rules for AI text that a human reviews and then sends to an outside party.
---

## Scrub every model-bound source, not just the block we assembled

**Why:** subcontractors routinely forward the solicitation back at us, so the
contracting officer's name, phone, and email arrive through their own message
and through extractor fields lifted from that text, not only through the
project facts we compose. Scrubbing our own block leaves three other doors
open, and output scrubbing is patterns rather than a guarantee. A name the
model was never shown is the only name it cannot leak.

**How to apply:** put the scrub in the helper that clips text for the prompt so
every field goes through it by construction. This is the mirror of the rule
that a fully rendered outbound email is never scrubbed: scrub on the way IN to
a model, never on the way out of the template renderer.

## Commitment checks warn, they do not block

**Why:** a person presses Send on every one of these, so the check is a second
pair of eyes, not a gate. Blocking leaves the operator with an empty box after
they have already paid for the generation, which is worse than a flagged draft
they can fix in ten seconds.

**How to apply:** generate, check, retry once naming the specific violation,
then surface with the warning attached. Only block when nothing downstream
requires a human to approve.

## Generate on demand, and keep what was generated

**Why:** most inbound mail never gets a written reply, so generating eagerly
spends money on messages nobody answers. And an operator who walks away
mid-edit should not pay a second time to get back where they were.

**How to apply:** key kept output to a real row, never to a synthetic
conversation key. Three consequences, each of which was a review finding:

- Only the newest message in a thread is answerable, and only when it is
  theirs. "Search backwards for the last inbound message" looks equivalent and
  is not: it keeps offering a settled question as unanswered. Enforce it in the
  domain layer too, since the endpoint takes an id from the browser.
- Consume-and-discard belongs in the same server request that consumed it. A
  clean-up the browser fires afterwards does not happen when the tab closes.
  Better still, make the leftover unreadable by construction so a failed
  discard is untidy rather than dangerous.
- Autosave ordering belongs in the database, not a client-side queue. The write
  that matters most leaves as the page closes, outside any queue, so it can
  overtake a stalled earlier one. Stamp each edit with a revision assigned when
  it is typed and apply it conditionally. The counter must only ever go up:
  resetting it on regeneration lets an in-flight edit from the previous draft
  look newer and restore text the operator just replaced.
