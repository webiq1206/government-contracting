# Complete homepage hero film

The previous homepage loaded a 15-second excerpt and stopped it after four seconds. The complete 30-second film had already been created on September 13, but was not connected to the page. This release recovers that film instead of spending more generation credits.

The silent sequence contains AI computing, government architecture, infrastructure, logistics, manufacturing, and aerospace. It is illustrative generated footage, not a claim about customers, facilities, contracts, or government endorsement. The product demonstration recordings delivered in PR #145 remain unchanged.

Only existing BrostCo media is used. The recovered source is the film saved in the BCO project; both new encodings use that exact footage. No unrelated stock, other-brand video, or new generated clips are introduced.

## Delivery

- Full 30-second landscape film for desktop and tablet.
- A smaller 30-second portrait encoding for phones, with chapter framing that preserves the government building, manufacturing equipment, and satellite.
- Continuous muted inline playback, with the four-second cutoff removed and no standalone pause button, as requested.
- Playback pauses offscreen and in hidden tabs. Reduced-motion or data-saving preferences retain a still image without downloading video.
- Source-loading and browser-playback failures preserve the poster and usable headline and trial action.
- Versioned video URLs and a new poster filename prevent reuse of the previous excerpt or poster.

The desktop film is approximately 4.5 MB; the portrait film is approximately 1.6 MB. Both contain fast-start H.264 video and no audio track. `public/marketing/hero-manifest.json` records the exact output sizes, hashes, durations, and source provenance.

## Reproduction and checks

Use the saved original `AI-Government-Procurement-Hero-30s.mp4`, whose SHA-256 is `42c4ef63c94c42bad5b8e274f82660b33237d16081dc7d314eb4e2001e3c5e16`. Run `node scripts/render-hero-media.mjs PATH_TO_ORIGINAL`. The script produces both encodings, the poster, and the manifest, then decodes both complete videos to reject corrupt output.

The source film and portrait chapter framing were visually inspected. Unit regressions cover playback past the old cutoff, viewport and tab visibility, reduced motion, data saving, phone-source selection, and loading failure. Asset checks require full duration, correct hashes, fast-start metadata, and size limits. The responsive browser audit verifies actual decode, progression beyond four seconds, the 30-second loop boundary, offscreen pause/resume, and reduced-motion behavior. It captures all six chapters behind the actual headline and trial CTA at desktop, tablet, and phone widths.

Current pull-request checks and review evidence are authoritative for merge readiness. Replit synchronization and publishing remain separate. Browser access to Replit was blocked by security verification; do not treat a Git merge as evidence that the site has been republished. No Replit Agent prompts or production migrations are part of this change.
