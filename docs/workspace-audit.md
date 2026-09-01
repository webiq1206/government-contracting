# Workspace audit

Every workflow in the product, read against one question: **can somebody finish
this piece of work without leaving the screen it started on?**

The answer used to be no in most places, and the reason was always the same
shape. A list told you what needed doing and then handed you a link. The work
happened somewhere else, in a layout you had to reorient in, and when it was
done the list you came from had moved.

This is the audit, what was done about each finding, and what was deliberately
left alone.

## The pattern, as this product uses it

Three panes, left to right:

| Pane | Answers |
| --- | --- |
| Queue | What is there to do, where am I in it, what is next |
| Record | The one thing I am working on, and everything I can change about it |
| Context | What the decision turns on: evidence, history, related records |

The queue is on the **left**. The pattern this is adapted from puts it on the
right, which is correct in an application whose reading starts at a document.
Here the reading starts at the queue: the sidebar is already on the left, three
surfaces already put their queue there, and moving it would mean the eye lands
somewhere different depending on which of four near-identical screens is open.

Responsive behaviour, decided once in `components/workspace/workspace-shell.tsx`
rather than per page:

- **≥ 1280px (`xl`)**: three columns, each owning its own scroll. That is what
  keeps the queue in place while the record moves.
- **1024–1279px (`lg`)**: two columns, context under the record. It is not
  dropped: what is in it is frequently the reason a decision goes one way, and
  hiding it would make a laptop a worse place to decide rather than a smaller
  one.
- **< 1024px**: one pane at a time. The queue until something is opened, then
  the record with its context under it. This is a CSS class rather than a
  second implementation, which is only possible because the open item is a
  query parameter.

Which thing scrolls changes with the direction, and it has to. Stacked, the
record and its context cannot both own a scroll region: two of them dividing
one screen gave the record about two hundred pixels, with the call workspace
and its own header and sticky foot inside them. So below `xl` the column
scrolls once, the record's header and its actions are sticky within it, and
`WorkspacePane` only becomes a scroll region at `xl`.

The action foot is capped at 45% of the viewport below `xl`. A foot that grows
with the number of choices is fine beside a queue on a desktop and is the whole
screen on a phone: six reply outcomes and their explanations once took two
thirds of it. The explanations moved into the body, and the cap makes sure the
next pane to grow a control cannot do it again.

Which item is open is **always** a query parameter, never client state. The
back button works, a position in a queue is a link somebody can send, and the
phone rule is a class rather than a fork.

### The rule that is easy to get wrong

Each of these pages resolves a **default** selection so a wide screen never
opens on an empty half. Feeding that resolved value to the shell hides the
queue and the page header the moment a phone loads the page, and the only way
back points at the URL that just did it. The flag that decides which pane a
phone gets must come from the URL, not from the resolved record.
`tests/workspace-shell-contract.test.ts` fails when it does not.

### Keyboard

Two bindings, everywhere, in `components/workspace/workspace-keys.tsx`:

- `J` / `↓` next, `K` / `↑` previous, `Esc` back to the list.
- `⌘↵` / `Ctrl+↵` for the pane's primary action, registered by the button
  itself so the binding cannot outlive the control it belongs to.

Plain letters never fire inside an input, a textarea, a select or a
contenteditable. A modifier combination always does, because "save this and
move on" is what somebody wants at the end of the field they are standing in.
The rule is a pure function in `lib/domain/keyboard.ts` with tests, because the
cost of getting it wrong is somebody's note and the record it was about, in one
keystroke, with no undo.

The hints are shown in the queue header. A keyboard nobody is told about is a
keyboard nobody uses.

---

## Findings and what was done

### 1. The one queue was six destinations — **built: `/workbench`**

`workQueue()` already collapsed replies, decisions, calls, quotes, bids and
blockers into one ordered list. What Today did with that list was render six
kinds of link. Clearing five items meant five page loads to five layouts and
five journeys back.

`/workbench` is the same list with the work attached to it. Every kind finishes
in the middle pane:

| Kind | Middle pane | Finishes with |
| --- | --- | --- |
| Reply to read | The subcontractor's whole message, why the reader stopped | Six outcome buttons, each of which records and advances |
| Pursue or pass | The decision brief, shared with `/review` | Pursue and next, Pass with a reason, more analysis, extend, snooze |
| Call | The existing guided call workspace | Its own save, which already offered the next call |
| Enter quotes | What is still unpriced, what is recorded, the entry form | Done and next |
| Review bid | The assembled package, its QA state and approval gate | The package's own approve and submit |
| Blocker | What automation could not get past, in its own words | Re-run and next, send back, skip, snooze |
| Waiting on a sub | Who, since when, and whether we can even reach them | Nothing that "completes" it: nobody here can. Nudge, call, snooze, or leave the clock running |

That last row is a deliberate refusal. A Complete button on a task nobody here
can complete teaches people to press it to make the row go away.

Every work item's `href` now points at the workbench, opened on that item; the
old per-kind deep link survives as `recordHref` so "open the whole record" is
still one click. Nothing lost a destination.

### 2. `/review` was two panes with no evidence and no next — **upgraded**

The brief said "weak on past performance" and checking that meant opening the
record page and losing the queue. There is now a third pane with the rubric's
own numbers: every dimension, its points, the maximum, the reason, and how much
of the notice could be read at all. Plus the flags, the source link, and the
record's facts.

Deciding now lands on the next decision rather than on the record just decided,
and `⌘↵` pursues. Passing still asks for a reason and is deliberately not bound
to a key: a queue worked at speed is exactly where that mistake gets made forty
times.

### 3. `/call-queue` had the split and not the rhythm — **upgraded**

The permanent split and the "Next: <company>" hand-off after a save were
already right. What was missing was knowing where you were: the header could
say how many calls there were and nothing could say which one you were on, so
an operator eight into twelve counted rows. Position and `J`/`K` added.

### 4. `/communications` was already three panes — **keyboard added**

The one surface that had the whole shape. It gained position and `J`/`K` over
the filtered list, so the keys walk the list the reader is actually looking at.

### 5. `/compliance` was a grid you lost your place in — **added a working mode**

The board answers "what does the next quarter look like", which is a real
question, and it stays exactly as it was. It is a bad shape for the other real
question: nine things are overdue, get them done. Nine editable cards in a
two-column grid, each expanded, filled in, saved and collapsed, while the grid
reflows underneath.

`/compliance?item=` is the same items in a three-pane workspace, ordered
overdue first: the list holds still, the card is open and editable in the
middle, and the right pane carries what the item actually is, how it is
renewed, and where to renew it — the paragraph that used to sit inside the card
and push the date field below the fold.

There is deliberately no "mark done" in the foot. Finishing a renewal means
changing the date or attaching the certificate, and both live on the card with
the validation that belongs to them.

### 6. `/contracts` was a list that led somewhere — **now master and detail**

Every contract was a card with a link on it. Reading five of them was five page
loads and five journeys back to a list that had reset to its first tab. The
record body was extracted to `components/contract-detail.tsx` and is now
rendered in two places: its own page, for a link somebody sends, and the middle
pane here. The right pane keeps the risks visible — the reason this contract is
in front of you — while you read the rest of it.

### 7. `/subs` had a read-only peek and no way through — **made actionable**

The drawer answered "is this the one" and then made you go somewhere else to do
anything about it, and closing it lost your place. It now has previous and
next through the rows on the page, a position, `J`/`K`, and a foot: the
preferred flag (the only decision anybody makes *while* scanning a roster), a
call link, and the next firm. Everything else about a firm is still edited on
its record, with the context that belongs to it.

### 8. `/authority` approvals were two letters in a grid — **added a workspace**

Two editable messages side by side, with the prospect's own numbers three
sections further down the page, so approving one meant scrolling away from the
only evidence it was worth sending. `/authority?draft=` puts the message in the
middle and the domain's rating, traffic, relevance, priority and the reasons it
qualified on the right. Approving advances.

### 9. `/admin/accounts` was a table you left to answer anything — **peek added**

A support question is nearly always "what is going on with this one", and
answering it meant leaving a filtered, sorted table for a record page and
coming back to a table that had forgotten both. The peek answers it in place,
with previous and next through the page of results.

It is read-only on purpose. Comping, suspending, scheduling a deletion and
signing in as somebody all belong on the record page behind a confirmation, not
on a control reached while scanning a list.

### 10. The submission checklist and the solicitation were on different tabs

`/opportunity/[id]` holds the checklist on the Requirements tab and the
document on the Files tab, behind a disclosure. The panel that renders it says
why that disclosure exists, in its own words:

> checking one extracted requirement against its source used to mean opening a
> new tab, finding the page, reading a paragraph and coming back. Doing that
> forty times is why nobody does it, and a checklist nobody checks is a
> checklist that gets trusted more than it has earned.

The disclosure removed the new tab and left the round trip: switch tab, expand
a file, read, switch back, find the row you were on. Forty times, on the
artifact that decides whether a bid is thrown out.

`/opportunity/[id]/requirements` puts the checklist, the requirement's own
state controls, and the document on one screen. Choosing a requirement opens
the document it was read from, at the page the analysis recorded. Filters for
what is still open, what can sink the bid, and what needs a question to the
agency.

Its own route rather than a fourth pane inside the record's tabs, for a
structural reason: three panes need a bounded height to scroll inside, and the
record page is one tall scroller with a sticky tab bar. Nesting a 70vh scroll
region in it would trap the wheel and give the document a third of the screen
it needs most. The record keeps the checklist as a list and a button opens the
version you work in, which is the move the compliance board already makes.

This is the one workspace whose selection is **client state rather than a query
parameter**, and the exception is deliberate: navigating to change rows would
tear down the rendered PDF and refetch it on every press of `J`, which is the
round trip the screen exists to remove. That makes the phone rule stricter
rather than looser, because there is no URL to go back to. It starts closed, so
a phone gets the checklist first, and the pane carries its own way back.

### 11. The automation log withheld its own evidence

`agent_logs` stores `input_json`, `output_json`, `opportunity_id`,
`subcontractor_id` and `bid_id`. `/agents` rendered none of them: agent, level,
action, message, reasoning. So the one screen somebody opens precisely when
something is broken was hiding the request that failed, the response that came
back, and the record it happened to.

Opening a row now shows all of it beside the stream, with the records resolved
to names, the payloads collapsed behind a disclosure, and a control to re-run
that agent. The list query is deliberately unchanged: fifty rows each carrying
two JSONB blobs is a slow page in exchange for nothing, so the payloads are
fetched only when a row is opened.

### 12. Every search result cost a page load to check

`/search` is where ⌘K sends you, and every row navigated away, so answering "is
this the one" cost a page load and a trip back to a search box that had been
cleared. Opportunities and subcontractors now carry a Quick look that opens the
same drawer the roster and the account table use.

Only those two kinds, and the limit is honest rather than arbitrary: a contract
row points at the list, a message row at the conversation centre, and a
document row at whatever record it hangs off, so there is no single record to
preview even if there were a loader for it.

### 13. The recap described the work and could not finish any of it

The daily recap and the workbench name the same things in different words. The
recap says "Rivera Mechanical is waiting on an answer" and "pursue or pass on
this one"; the workbench holds the item that answers them. Every recap row
linked to a page where the thing could be *read* -- the opportunity record, the
call queue, the subcontractor's file -- so a morning list of eleven things was
eleven trips out to find the control that finishes each one.

The task-shaped rows now point at `/workbench?i=<key>`: a decision opens on
`Pursue & next` and `Pass`, a call on the card, a flagged reply on the
subcontractor's own words with the outcome controls under them.

The mapping is a tested module rather than an inline template string
(`lib/domain/recap/destinations.ts`), because it is the part that rots: the
recap's queries and the workbench's queries are written separately, and a row
pointing at a workbench item the workbench would not list lands somebody on
another person's work. Only rows whose recap filter is a subset of the
workbench's are converted. Unanswered replies are the one that is not a subset
-- the recap counts every reply nobody has answered in three weeks, the
workbench only holds the ones the automatic reader flagged -- and the fact
carries both flags, so the two are told apart exactly rather than guessed at.
A drafted, unsent reply has no workbench item of any kind and keeps its old
destination.

Two consequences worth naming:

**The workbench had to learn to refuse a stale link.** `resolveSelection` falls
back to the first item so a wide screen is never blank, which is right when
nobody asked for anything in particular. Under a link that named a specific
piece of work it is how a person answers the wrong subcontractor. A key the
queue no longer holds now opens nothing and says so.

**A row that points at work still previews its record.** The workbench link is
a queue address, not a record, so `RecapItem` carries `recordHref` beside
`href`: what the row is about, as opposed to where the row takes you. The
Quick look reads the first and falls back to the second.

### 14. The recap history kept the mail and would not show it

`Settings -> Daily recap` ends in the delivery record, and the delivery record
has always kept the rendered copy of each send -- that is what lets a retry
send the mail written for that morning rather than a fresh recap describing a
different day. It was unreadable. The list showed a subject, an address and, on
a bad morning, a provider's error string, and answering "what did they actually
receive" meant asking the recipient to forward it back.

Sends on the left, the one you picked on the right: its state, its error, the
retry, and the mail itself in a sandboxed frame, served by
`/api/recap/deliveries/[id]/html` and scoped to the caller's own organization.

Fixing that turned up a header bug that had been breaking the live preview
beside it since the day it shipped. `next.config.mjs` sets
`X-Frame-Options: DENY` for every path; a route handler setting `SAMEORIGIN`
has its value **appended** rather than substituted, the browser receives two
conflicting values and takes the stricter, and the preview frame has been a
"localhost refused to connect" panel ever since. Both routes now say it with
`Content-Security-Policy: frame-ancestors 'self'`, which a browser honours over
`X-Frame-Options` and which is the only form that can override an inherited
header.

### 15. Six groups of settings in one scroll

The same page is 600 lines of stacked cards, and the two questions people
arrive with -- who is getting this, and did yesterday's go out -- are the two
furthest down. It has a rail now: the sections named up front with the state
that would make you pick one (the send time, how many sections are on, how many
recipients, how many sends need a decision), and the Save button riding along
so it is on screen wherever you jumped to. Wide screens only. On a phone the
sections are already one column in reading order, and a rail above them is a
second list to scroll past before reaching the first.

---

## Considered and deliberately not converted

Not everything is a queue, and forcing the pattern where the work is not
sequential makes a screen worse.

**`/pipeline`** is a board. Its job is the shape of the whole pipeline, and it
already has a peek drawer for reading a card without leaving. Turning it into a
master-detail would answer a question the board is not for. The cards' link
into the record is correct, because opening an opportunity is the beginning of
a long piece of work rather than the end of a short one.

**`/opportunity/[id]`** is already a consolidated workspace: seven tabs, one
record, everything editable in place. Its tasks reach the workbench from the
queue; the record is where you go to study rather than to process.

**`/today`** is a dashboard and should stay one. It answers "what kind of day
is this" with counters, a digest, health and the queue preview. Its queue rows
now open the workbench, which is the change that mattered.

**`/subs/[id]`** was named as a candidate on a first pass and the reading was
wrong: it is already an eight-tab editorial record with a Communications tab
that reads and replies in place. The stack of collapsibles that prompted the
finding lives inside those tabs. Nothing was changed.

**`/analytics`, `/how-it-works`** are reading surfaces with no per-record work
to finish.

**Settings, `/settings/content`** — the template editor is already a two-pane
editor with a live preview, which is this pattern under a different name. The
other settings pages are forms; a queue of one form is a form.

**`/admin/audit`, `/admin/billing`, `/admin/health`** are ledgers and status
boards. Nothing in them is processed row by row.

---

## Where the shared parts live

| File | What it is |
| --- | --- |
| `components/workspace/workspace-shell.tsx` | The three panes, the responsive rules, the pane frame |
| `components/workspace/queue-rail.tsx` | The numbered queue, its states and its position |
| `components/workspace/workspace-keys.tsx` | `J`/`K`/`Esc`, the shortcut hook, the hint chip |
| `components/workspace/advance-action.tsx` | Act-and-next, and skip-without-writing |
| `lib/domain/workspace-queue.ts` | Position, neighbours, what "next" means, link building |
| `lib/domain/workbench.ts` | Which pane a task opens into, and what it is called |
| `lib/domain/keyboard.ts` | When a keystroke belongs to the page and when to the field |
| `lib/workbench.ts` | Loading the record behind the open task, per task |
| `components/requirements-workspace.tsx` | The checklist beside the document it was read from |
| `components/agent-run-peek.tsx` | One automation run, in full |
| `lib/domain/recap/destinations.ts` | Which recap rows can be finished, and where |

Tests: `tests/workspace-queue.test.ts`, `tests/workbench-panes.test.ts`,
`tests/workspace-keyboard.test.ts`, `tests/workspace-shell-contract.test.ts`,
`tests/work-queue-destination.test.ts`, `tests/queue-rail.test.tsx`,
`tests/requirements-workspace.test.tsx`, `tests/agent-run-detail.test.ts`,
`tests/search-peek.test.ts`, `tests/recap-destinations.test.ts`,
`tests/recap-delivery-pane.test.ts`.
