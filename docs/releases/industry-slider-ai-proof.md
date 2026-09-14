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


## Final landing-page review

The later hero direction supersedes the initial split layout. The H1 is
“AI that finds government contracts and prepares your bids.” The category label
is “AI Government Procurement Platform.” Supporting copy names subcontractor
coordination, follow-ups, document preparation, and human calls and review.
A single free-trial action leads the centered hero.

| Area | Review outcome |
| --- | --- |
| Above the fold | Centered hierarchy, readable overlay, category label, one primary trial action, no product cards competing with the message. |
| Background media | User-supplied `untitled.mp4`, optimized as a 15-second, 720p H.264 loop with fast-start metadata. No audio. A still frame renders first; playback pauses offscreen, in hidden tabs, and at the visitor's request. Reduced-motion and data-saving preferences keep the still. |
| Industry coverage | All 20 broad sectors are represented. Swipe, keyboard, arrows, optional playback, directory filtering, and empty-state recovery are supported. |
| Product explanation | Five approved AI-led stages show concrete outputs, including successful quote follow-through and a prepared bid. Calls and final review remain distinct. |
| Repetition and differentiation | The repeated feature section now explains company context, connected inbox conversations, and traceable activity. |
| Desktop reading | Text columns stick within their section and release at its bottom. A size observer disables sticking for text that exceeds the available height. Mobile and tablet use normal scrolling. |
| Conversion | Trial CTA and pricing remain consistent. Optional promotion failures fall back to standard pricing on both the homepage and signup. Analytics writes run after the response so they do not delay either page. |
| Search and sharing | Homepage metadata uses a clear platform title without duplicating the brand template. Industry and workflow-example anchors are discoverable in the site map. |
| Media accuracy | Existing product films use captured screens. Their descriptions now say guided screen previews rather than recordings of live interactions. |
| Trust | Illustrative perspectives are labeled individually; product links, data practices, company details, and trial terms are visible. Verified customer testimony and measured outcomes have not been supplied. |

### Production limits

The implementation can be validated independently of deployment. Actual customer
endorsements, refreshed live-interaction demo recordings, real-device field
performance, and the deployed Replit revision still require evidence. Do not call
the entire business or product enterprise-certified on the strength of a website
redesign, or remove example disclosures to imply verified customer results.

### Assets

The supplied video is committed at `public/marketing/hero-background.mp4` and its
fallback frame at `public/marketing/hero-poster.jpg`. The earlier generated
infrastructure still was superseded by the user's film and is not referenced by
the site. No generated customer portraits or logos are used.
