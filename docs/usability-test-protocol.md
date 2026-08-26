# Usability test protocol

Sequence step 11. Everything needed to run the test except the people.

This document exists because that gap is real and worth naming: the rest of
this redesign could be verified by a machine, and this part cannot. A test run
by whoever built the thing measures how well they remember building it.

## Who

Five participants. Five is where the curve flattens for this kind of test: the
first three find most of what is findable, and the fourth and fifth confirm
whether what they found was a pattern or a person.

They must be:

- **Federal or state subcontracting people** -- estimators, bid managers,
  small-firm owners who bid public work. Someone who has never chased a
  subcontractor for a price cannot tell you whether the quote deadline reads
  correctly.
- **Uncoached.** No demo, no walkthrough, no "let me just show you where that
  lives". If somebody needs telling, that is the finding.
- **Not employees, and not the people who asked for this.** Both know what it
  is supposed to do, which is precisely the knowledge the test is trying to
  do without.

At least one participant should work primarily from a phone. The mobile
experience is a third of this redesign and the least likely to be tested by
someone sitting at a desk.

## Setup

A real account, seeded with real-shaped data: forty to sixty open
opportunities, a hundred subcontractors, a mixed communication history
including bounces and partial quotes. A clean account tests nothing, because
the interface's whole job is to make a full one legible.

Record the screen and the audio. Do not record the participant's face; it adds
nothing here and makes people perform.

## Tasks

Give each task as a goal, never as a route. "Find the most urgent
opportunity", not "open Today and look at the top of the list".

1. **Find the opportunity that most needs you today, and say why.**
2. **A bid is blocked. Work out what is blocking it.**
3. **For one opportunity, say which trades still have nobody quoting.**
4. **A subcontractor gave a price for part of the work. Record it.**
5. **An email to a subcontractor failed. Fix the address.**
6. **Tell me the date the government needs our bid.**
7. **Tell me the date we asked subcontractors for their prices.**
8. **Automation has stopped. Find out why and what you would do about it.**
9. *(on a phone)* **Do task 1 and task 5 again.**

Tasks 6 and 7 are the pair that matters most. They are the two deadlines, and
if a participant gives the same answer to both, the vocabulary work in
`lib/domain/terminology.ts` did not land where it counts.

## What to record

Per task:

- Completed, completed with difficulty, or not completed
- Time
- Wrong turns: every page opened that was not on the path
- Questions asked aloud
- Labels read aloud and then acted on incorrectly
- Warnings scrolled past
- Actions taken by accident
- Hesitations longer than about five seconds, and what was on screen

## Rules for whoever runs it

- **Do not explain the interface.** Not once. "What would you do next?" is the
  only prompt.
- **Do not defend it.** A participant saying something is confusing is data,
  not an argument to win.
- **Let them fail.** The moment somebody is rescued, that task stops
  measuring anything.
- If a participant asks where something is, write down the question and say
  "have a look around". If they still cannot find it, the task is failed.

## Thresholds

- **A task failed by two of five participants is a defect**, not a training
  problem. Fix it and re-test with fresh participants.
- **Any participant who gives the same answer to tasks 6 and 7** means the
  two deadlines are still not distinguishable. That one is a blocker.
- **A phone task that takes more than twice its desktop time** means the
  mobile version is a compressed desktop page, whatever it looks like.

## After

Findings go into `docs/redesign-traceability.md` as ordinary rows, with the
same keep/change/remove decision as everything else. A finding that produces
no change needs a written reason, in the same place, so the next person can
see it was considered rather than missed.
