# Recorded product demonstration delivery

This continuation replaces the earlier still-screen previews with original recordings of the redesigned application. Work is tracked in [PR #145](https://github.com/webiq1206/government-contracting/pull/145). The PR's current checks and merge status are authoritative. A merged source change does not establish that Replit has synchronized or published it.

## Deliverables

| Asset | Length | Story and destination |
| --- | --- | --- |
| Main platform walkthrough | 135 seconds | Narrated opening, six connected chapters, final-review message and trial CTA. Homepage product-evidence player and `/demo`. |
| Quick preview | 16 seconds | Switch the opportunity view and open the connected record. Available from `/demo`; does not replace the user's supplied decorative hero film. |
| Pipeline | 20 seconds | Change to List, inspect the same sample pursuit. `/demo` and the reusable workflow gallery. |
| Requirements | 20 seconds | Open Requirements and return to Overview, with staged analysis explicitly identified. |
| Subcontractors | 20 seconds | Move from the company record to Opportunities and Quotes. |
| Communications | 20 seconds | Expand earlier messages, then return to the latest reply. |
| Opportunity preparation | 20 seconds | Open subcontractor quote coverage and Pricing. Final review remains with the team. |
| Activity | 20 seconds | Expand a recorded event and inspect history filters. |

Every asset has desktop and native-phone MP4 versions, a poster for each format, English WebVTT captions, and a plain-text transcript in `public/demos`. Desktop output is 1600 by 1000. Phone output is 720 by 1600 so the complete 390 by 760 application viewport stays readable without cropping away controls. Files use H.264 with fast-start metadata; narrated files include AAC audio. Narration is synthetic and normalized toward -16 LUFS with a -1.5 dB true-peak target. The quick preview is silent.

The source of truth for words, scene headings and on-screen points is `scripts/ui-audit/product-demo-scenes.json`. Audio masters are in `scripts/demo-assets/narration`. The published manifest records output hashes, durations, dimensions, source revision, recorded action names and source hashes. These are actual UI transitions, not AI-generated representations of the product.

## Safety and accuracy

All source recordings use a disposable PostgreSQL CI workspace. The capture script rejects non-CI and non-disposable database settings. Browser traffic is limited to the local application. The data contains explicitly synthetic companies, a sample federal opportunity, sample quote amounts, staged analysis and sample message history. No live AI analysis, external outreach, call, payment, bid submission or award is demonstrated. The visible footer and page copy preserve these limits.

The demonstrations inspect navigation and review states. They do not imply that opening a screen completes the underlying business task. The story deliberately keeps final pricing, terms, signatures and submission with the user's team.

## Playback behavior

Players have native keyboard-accessible controls, inline playback, captions and transcript links. They never autoplay or preload video bytes. Phone layout space is reserved before hydration. Format is chosen once so rotating a device does not restart playback. Starting another product video pauses the prior one; leaving the viewport or hiding the page pauses playback. Both media-element and source-element failures reveal a retry button and transcript link. Retry replaces the failed media element.

This adds no third-party analytics, cookies, visitor identifiers or application-content tracking. The existing authenticated analytics endpoint is not repurposed to collect anonymous visitors. Public playback/conversion analytics and representative-user measurements remain separate follow-up acceptance work.

## Reproduction and verification

1. Run the **Product demo capture** workflow against the desired revision. The workflow creates the disposable database and records desktop and phone interactions. Download its `product-demo-recordings` artifact.
2. Extract the `product-demo` folder without flattening the `raw` duplicates into the selected files. Keep `provenance.json` beside the named WebM files.
3. Run `node scripts/ui-audit/render-product-demos.mjs PATH_TO_PRODUCT_DEMO_FOLDER`. It uses the committed audio masters, requires ffmpeg/ffprobe, and writes published files plus an integrity manifest. `DEMO_PREVIEW_FORMAT=desktop` or `mobile` produces a scratch preview without changing published media.
4. Run TypeScript, the full application tests, a production build, and the mandatory CI database gate. The media integrity suite verifies both formats, fast-start structure, hashes, captions and duration limits. The player suite covers phone selection, pause coordination, hidden-page behavior, failed requests and retry.
5. Run the responsive UI audit. Its `/demo` scenario decodes and plays the MP4, loads captions, seeks, changes players, pauses offscreen, blocks a media request and recovers with Retry. Inspect its screenshots as well as the encoded footage.

The old still-preview generator now writes only to `artifacts/redesign/legacy-previews`; it cannot overwrite this delivery.

Capture also exposed and fixed a phone pipeline bug: its View disclosure stayed over the list after selecting a view. The menu now closes on selection, Escape and outside pointer input. Escape restores focus to the disclosure. Tests cover the behavior, and the recording exercises selecting a view followed by opening a record.

## Source release versus live release

Require green checks on the exact PR head before merging to `main`. Replit browser access is currently stopped by a persistent security-verification screen. Its publishing status only confirms that an earlier site is live, not that the latest Git revision is present. No Replit Agent prompt or unverified republish is used.

After workspace access is restored, follow `replit-reconciliation.md`, preserve local changes, synchronize the merged `main`, verify the exact checkout, publish, and smoke-test the resulting site. No production schema migration is introduced. Rollback is a normal Git revert and redeployment of the application and bundled media.

Real-device Safari/fullscreen behavior, listening review by the product owner, field performance, representative-user task timing and live provider smoke tests are not replaced by synthetic CI results. Earlier generalized product candidates remain as documented in `docs/redesign/feature-preservation.md`.

## Continuation verification, September 16

The completed package and prior remote capture changes are preserved in local commit `e56b527aa600505238529c5b027b8f065b4394d4` on `codex/final-product-demonstrations`. The working tree was clean after reconciliation. TypeScript and the production build passed again. All 23 focused demo, player, marketing and mobile menu tests passed. The full local suite passed 4,624 tests and skipped 735 database-dependent tests; two timezone-dependent tests failed under the host's Europe/Berlin timezone. Both affected suites passed when rerun in UTC (11 tests), matching the CI environment. No application behavior was changed to work around those test assumptions.

The 16 final media files have matching manifest hashes and successful saved full-file decode and loudness validation. Final desktop and phone frames and branded posters were visually inspected. The final branch still needs its database and responsive browser CI gates before merging.

Initial GitHub push attempts were rejected by automatic approval review, including after retrieving the user's previous instruction to commit, push and merge. No alternate write path was attempted. The user subsequently gave direct approval in this chat to push these BrostCo changes to `webiq1206/government-contracting` and merge PR #145 after its final checks pass. The PR's latest head and checks are authoritative; the earlier incomplete capture-only head `bdded83fda8bc9a9670c7c4e68e24f852f548147` must not be merged on its own.

At the last browser check, Replit's workspace displayed its security-verification page after one reload, and the public `/demo` page presented the older captured-screen previews. Source synchronization, publishing and verification of the new live revision remain separate from GitHub acceptance. Direct GitHub approval is now recorded; pass the final checks and merge the completed package before reconciling the Replit workspace.
