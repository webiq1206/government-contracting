# Industry discovery and clearer AI work

The homepage previously named only three industries and showed a sample pursuit
with the same unresolved quote at several stages. That made the product appear
narrower and more dependent on manual coordination than its implemented workflow.

## Changes

- Replace the static strip with a responsive, swipeable industry slider covering
  all 20 broad sectors in the Company Profile industry catalog. Add keyboard and
  previous/next controls, optional playback, reduced-motion handling, and a
  searchable all-sector directory with an empty-state recovery action.
- Make AI the actor in the homepage and shared five-stage walkthrough. Show a
  matched opportunity, extracted brief, sent outreach and follow-ups, captured
  quote replies, and prepared bid documents. Separate completed automation from
  calls and final reviews. Keep setup, service connections, automation rules,
  quote confirmation, signatures, and submission responsibilities clear.
- Add a featured story card, two supporting cards, and links to product recordings,
  security information, and the free trial. These are illustrative perspectives,
  explicitly identified on every card. They are not customer testimonials or
  outcome measurements. No customer identities, portraits, logos, star ratings,
  certifications, or success statistics are invented.
- Align the Platform, How AI works, and Subcontractor pages with the same message.
- Preserve authenticated product behavior, pricing, integrations, and trial flow.

## Evidence and verification

Industry coverage is checked against every code in `lib/naics.ts`. Automation
language is grounded in `lib/domain/knowledge.ts`, including scheduled discovery,
scoring, configured outreach, reply processing, and automatic bid preparation
when required pricing is present.

The focused visitor tests cover routes and anchors, matching FAQ structured data,
example disclosures, full sector coverage, slider progression and wrapping,
playback pause, reduced motion, workflow tabs, source expansion, and sample review.
The existing CI browser audit now also checks the live rendered slider, industry
search and recovery, and captures the industry and story sections at each viewport.

## Replacing the illustrative perspectives

`components/marketing/customer-stories.tsx` contains the three example stories.
Before presenting these as social proof, replace them with approved customer
quotes and real attributions. Obtain the customer's permission to use their name,
company, and any image or logo. Link claimed outcomes to the supporting case study.
Remove the example disclosures only for material that has actually been verified.
Do not relabel these fictional perspectives as customer testimony.

## Replit handoff

Changes are delivered through the Git repository. Replit Agent is not used.
At implementation time, Replit's workspace was still behind its security
verification page, so a current workspace Git revision could not be confirmed.
Sync the merged main revision into the workspace before republishing; a successful
publish status by itself does not establish which Git revision is deployed.
