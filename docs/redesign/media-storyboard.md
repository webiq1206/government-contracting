# Product media: delivered previews and final recording plan

## Delivered assets

All footage is original BrostCo material generated from synthetic QA screen captures. The current videos are **guided screen previews**, not recordings of authenticated actions. Every asset has an MP4, English VTT captions, and a text transcript in `public/demos`. They have no audio narration. The generation source is `scripts/ui-audit/build-preview-media.py`; duration/codec checks are in `evidence/media-validation.json`.

| Asset | Duration | Destination | Screen/story |
| --- | --- | --- | --- |
| hero-preview | 15s | Homepage hero | Today queue and clear next action |
| platform-walkthrough | 120s | Homepage “See the product” | Today, opportunities, review, subs, pursuit and activity |
| pipeline | 24s | Find opportunities tab | Whose turn, fit/timing, list/board/table choice |
| review | 24s | Make decisions tab | Decision context, known facts, pursue/pass |
| subs | 24s | Build your team tab | Search roster, inspect relationship, related work |
| opportunity | 24s | Prepare the bid tab | Next step, record sections, final review |
| activity | 24s | Track the work tab | History, search/filter, inspect result |

The five gallery players share one mounted video. Choosing another tab replaces it. Arrow keys, Home, and End select tabs; native controls support playback and captions. Heavy video files use `preload="none"`, reserve their dimensions, and do not autoplay. Posters and transcripts explain the content even when the video cannot be used. The main MP4 was observed decoding and playing in the browser without a media error.

## Final recording storyboard and narration script

Record the real redesigned application after browser workflows pass. Use clearly synthetic records, show sample-data labels, hide secrets, and keep integration simulations visibly labeled. Do not represent a draft, staged send, generated file, or demo submission as real delivery or a contract award.

| Time | Required recorded action and result | Final narration |
| --- | --- | --- |
| 0–15s | Open Today; select the top actionable task; show the connected record | “Federal contracting brings opportunities, deadlines, people, and documents into the same day. BrostCo puts the work that needs you in one queue.” |
| 15–35s | Open Opportunities; narrow a view; inspect a matching pursuit and its source | “Find work that fits your company. See fit, timing, and whose turn it is. Open the opportunity to check the information behind the recommendation.” |
| 35–55s | Open Review; inspect strengths and unknowns; record a safe fixture pursue decision; show updated state | “Make the decision with the context in front of you. Review what is known, see what needs checking, and choose whether to pursue. The resulting work stays with the same opportunity.” |
| 55–75s | Open related subcontractors; inspect a contact; open a prepared outreach draft without sending | “Bring the right subcontractors into the pursuit. Keep contacts, qualifications, outreach, and the next conversation connected, so your team does not have to rebuild the context.” |
| 75–100s | Open requirements, source and pricing; reveal readiness; inspect a generated demo document | “Move through requirements, pricing, and bid materials in one workspace. Open the supporting detail when you need it. Missing information stays visible, and your team keeps final review, signatures, and submission.” |
| 100–115s | Open Activity; find the fixture action; inspect recipient/output and outcome | “See what happened and what came out of it. Activity gives your team a way to trace decisions, messages, and results.” |
| 115–120s | End on signup CTA and actual current trial terms | “Start your free trial at BrostCo. Add your company, connect the services you need, and move your next pursuit forward.” |

Adjust timing to the recorded action; never accelerate a decision beyond legibility. Rewrite a line if a verified workflow behaves differently. The delivered preview transcripts remain accurate to what their still-screen scenes actually show.

## Short clip recordings

Each 20–45 second final gallery recording must show context, one real UI action, and its result:

- Find opportunities: choose a view/filter, open a match, reveal evidence.
- Make decisions: select an item, inspect its brief, make a fixture-only decision, show the updated queue.
- Build your team: filter roster, open a contact, show related pursuit and prepared draft.
- Prepare the bid: inspect a requirement/source, reveal a missing item, show the reviewable output.
- Track the work: search a recorded event, expand details, open the associated output.

The hero recording should show Today to a completed safe task and its visible result in 10–20 seconds. A still screen with changed title cards does not close that requirement.

## Final media acceptance

Capture readable mobile-specific framing for narrow players, and offer full-screen playback. Record the main narration; verify pronunciation, caption timing, transcript completeness, and audio level. Test gallery switching, keyboard controls, captions, mobile seeking/fullscreen, reduced motion, failed requests, slow connections, and playback/CTA analytics using the existing consent/data rules. No new session tracking or private-content capture is introduced by this branch.
