# Homepage feature video placement

All eight BrostCo product recordings are now reachable directly on the homepage. Each player selects the existing desktop or phone recording. The decorative 30-second hero film is separate and unchanged.

| Homepage context | Recording |
| --- | --- |
| Introduction, optional 16-second preview | `hero-preview` |
| Discovery and review, directly below the hero ribbon | `pipeline`, `review` |
| Subcontractors and conversations, in the second chapter | `subs`, `communications` |
| Bid preparation and activity, before the first-week plan | `opportunity`, `activity` |
| Product evidence, before pricing | `platform-walkthrough` |

The six feature tours form three chapters with one visible player per chapter. Two labelled tabs switch each chapter's original recordings without resetting the players. Selection pauses the outgoing video immediately. Keyboard arrows, Home, and End move focus with the selection, and the tablist orientation follows the layout. All six players remain in the page alongside the short preview and full tour.

Desktop chapters pair concise copy with a larger video frame, reversing the second chapter's composition. Tablet selectors sit side by side. Phones use compact selectors and uncropped portrait videos capped at 232 pixels, including after rotation. The interactive sample workflow and short preview remain in keyboard-accessible disclosures. The page shows three feature frames rather than six, shortening the main reading path. The first-week plan and product evidence use tighter copy, and the final trial invitation has a distinct dark treatment. The price amount regains its intended prominence and footer labels keep their compact scale on phones. Dark sections have clear keyboard focus. Pricing, trial terms, and sample provenance remain visible. Untouched players remain idle until playback is requested.

No video assets were changed or added. All product players retain native controls, no autoplay, no video preloading, failure recovery, phone source selection, and coordination that pauses the previous player. Recorded sample data and staged AI results remain identified. No external messages or bid submissions are demonstrated.

The homepage regression checks verify all eight players, exact feature placement, no early product-video requests, all six feature decodes and captions, 20-second durations, single-player playback, responsive sources, and the short preview's keyboard and closing behavior. Browser checks also cover one visible panel per chapter, keyboard selection and focus, hidden-player pause, narrow and landscape layouts, the optional interactive workflow, and screenshots of all chapters and the remaining homepage sections. The product-tour page remains available.

Source changes require passing CI and responsive browser checks before merging. A GitHub merge does not synchronize or publish Replit.
