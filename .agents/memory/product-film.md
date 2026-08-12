---
name: Landing product film
description: How the marketing product film is built and the constraints that keep it legible and actually playable.
---

# Landing product film

The film on the marketing landing page is a **rendered asset**, not a live
component: a time-driven film set is captured frame-by-frame with Playwright
and encoded with ffmpeg. Source lives under `components/marketing/` with a
dev-only capture route; the render script produces the files in `public/film/`.

## The film set is a pure function of time

The set exposes a seek function on `window` and is screenshotted one frame at a
time. **Why:** frame-exact determinism, and it lets the UI genuinely respond to
a scripted cursor (rows highlight, values count up, buttons depress) instead of
panning a camera over frozen screenshots — which is what the previous version
did and why it looked static.

**How to apply:** never introduce CSS transitions/animations or `Date.now()`
into the film set. Anything not derived from the seek time will tear across
frames or render inconsistently.

## Mobile legibility sets the type floor, and it is stricter than it looks

The video renders roughly **310 CSS px wide on a phone**, so a 1920-wide frame
is downscaled about 6x. Full desktop dashboard screenshots are unreadable at
that size — that was the original bug report ("a black box", text 2-3px tall).

Scenes are therefore **composed for the frame at film scale**, not cropped from
real screens, and each shot shows only about one card or a handful of rows.
Measured floor: primary text survives down to ~34px, but anything below ~30px
turns to mush. Mono labels and secondary/caption-detail lines are the usual
offenders.

**How to apply:** verify legibility empirically rather than by eye on a desktop
frame — downscale a rendered frame to ~310-360px wide and then upscale it back
with nearest-neighbour. Whatever is unreadable in that image is unreadable on a
phone. Judging the 1920px frame directly will always look fine and is worthless.

## Scene overflow must be audited, not eyeballed

Scene content sits in a fixed band between the top strip and the caption bar.
Raising type sizes silently pushes content behind the caption bar, and it is
easy to miss when spot-checking a few frames.

**How to apply:** after any type or content change, script an audit that seeks
through every beat and compares the union of child bounding boxes against the
available band height. Several beats overflowed after a type bump and only the
audit caught them.

## Public marketing assets must be allow-listed in the edge middleware

The middleware redirects anonymous requests to `/login`. Its static-asset
bypass listed only a few image extensions, so the film's `.mp4`, `.jpg` and
`.vtt` files **307-redirected every logged-out visitor** — the film was broken
for exactly the audience it exists for, while working fine for a signed-in
developer.

**Why:** this class of bug is invisible in local testing with a session cookie.
**How to apply:** add a public **path prefix** for new marketing asset
directories. Do *not* broaden the global file-extension bypass — a protected
route ending in that extension would then skip authorization entirely.
Verify with an unauthenticated request, not a browser that holds a session.

## Player: never infer "playing" from `play()` resolving

`play()` resolving means playback was *permitted*, not that frames are on
screen. Using it to flip the control to "Pause" is what left mobile viewers
staring at a still frame under a Pause button while the file buffered.

**How to apply:** drive play state from real playback events (`playing`,
`waiting`, `pause`) and keep a visible play affordance whenever not actually
playing. Also pick the encode in an effect — the `media` attribute on `<source>`
is not honoured reliably once a video has loaded.
