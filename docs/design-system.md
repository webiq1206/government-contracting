# Design system

What already exists in `app/globals.css` and `tailwind.config.ts`, written down
so it can be followed rather than guessed at, plus the responsive rules that
were previously decided per component.

This is a description, not a proposal. Where a rule below differs from the code,
the code is the bug.

## Breakpoints

Three modes, and every shared component has a defined behaviour in each.

| Mode | Width | Tailwind |
| --- | --- | --- |
| Mobile | below 768px | (default) |
| Tablet | 768px to 1199px | `md:` |
| Desktop | 1200px and above | `lg:` / `xl:` |

`sm:` (640px) is used for typography and padding easing inside the mobile mode.
It is not a fourth mode: no layout decision hangs on it.

## Spacing

One scale: **4, 8, 12, 16, 24, 32** pixels, which is Tailwind `1, 2, 3, 4, 6, 8`.
Page padding is `p-4` on mobile and `p-5`/`p-6` from `sm:` up.

Arbitrary values (`mt-[21px]`) are allowed in exactly one case: aligning a
decorative element to the optical centre of another element, where the correct
number is dictated by that element rather than by the scale. There is one in
the codebase, on the pipeline strip's connector line. Any other arbitrary
spacing value fails `tests/design-system.test.ts`.

## Grid

4 columns on mobile, 8 on tablet, 12 on desktop, where a grid is used at all.
Most working surfaces are flex rather than grid, because their columns are
"list and detail", not "twelve equal units".

## Typography

| Level | Class | Use |
| --- | --- | --- |
| Page title | `font-display text-2xl font-semibold` | Once per page, in `PageFrame` |
| Section title | `font-display text-lg font-semibold` | A section within a page |
| Card title | `font-display text-base font-semibold` | A record or panel heading |
| Body | `text-sm` | Everything a person reads in sentences |
| Supporting | `text-xs text-muted-foreground` | Secondary detail beside body text |
| Label | `.label` | Field labels and column headers |
| Metadata | `text-[0.65rem] uppercase tracking-[0.12em]` | Timestamps, counts, definition-list keys |

`.num` is for figures: tabular numerals, so columns of money and counts line up.

`text-3xl` and `text-4xl` are allowed on the **one** hero element a screen may
have: the day's greeting, a bid cover page, a single readiness figure. Above
`text-4xl` the only thing that still reads well is a number on its own, so
`text-5xl` requires `.num` on the element or its child. `text-6xl` and up are
not used in the application at all.

Not used: all-caps for anything longer than a label, and the serif face for
body copy.

## Colour

Semantic tokens are CSS variables, so light and dark swap together. Never write
a raw hex or a stock Tailwind colour in a component.

| Token | Meaning |
| --- | --- |
| `background` / `foreground` | The page and its text |
| `surface` / `surface-raised` | Panels, and panels on panels |
| `muted` / `muted-foreground` | Recessed fills and secondary text |
| `border` / `border-strong` | Hairlines and emphasis hairlines |
| `pursue` | Good, done, healthy |
| `review` | Needs a person, degraded, warning |
| `risk` | Blocked, failed, destructive |
| `gold` / `accent` | Brand emphasis. Not a status |

### Colour is never the only signal

Every status pairs a colour with a **word**, and where the status is
load-bearing, a glyph as well. The automation chip carries `●▲✕⏸○`; the
compliance badge carries its label. A red dot and an amber dot are the same dot
to a red-green colourblind operator, and status is exactly where that matters.

## Buttons

One primary action per screen or active workflow section. `.btn-primary` is
that one. `.btn-ghost` is everything else. `.btn-danger` lives in a separated
danger area, never inline beside ordinary actions.

Minimum target 44x44px on touch: `min-h-11` on anything a thumb has to hit.

## Shared components

| Component | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| `PageFrame` | Title, explanation, status stacked; primary action full width below | Same, action inline | Title left, status and action right |
| `Breadcrumbs` | Replaced by the back control in the app bar | Shown | Shown |
| `Nav` | Hidden; opens as a full-screen overlay from the app bar | Collapsed rail, 72px | Expanded, 248px |
| `MobileTabBar` | Fixed bottom, 64px, five destinations | Hidden | Hidden |
| `DataTable` | Becomes compact cards, one record per card | Table, fewer columns | Full table, sticky header |
| `FilterToolbar` | Button opening a full-screen sheet | Inline, wrapping | Inline, sticky |
| `ContextDrawer` | Full-screen page | Right panel, `max-w-md` | Right panel, `max-w-lg` |
| `AutomationStatusPanel` | Facts stack two-up | Four across | Four across |
| `AccountStatusPanel` | Label above value | Label beside value | Label beside value |
| Long forms | One section per screen, sticky bottom bar | Grouped sections | Grouped sections, sticky save |

Rules that hold for every one of them:

- No horizontal page scroll at any width. Wide content scrolls inside its own
  `overflow-x-auto` container.
- No critical field, status or action disappears on mobile. It moves; it does
  not vanish.
- No hover-only affordance, and nothing important behind a tooltip.
- No unlabelled icon for an action.

## States

Five, and all five are distinct. `components/page-states.tsx` holds them.

| State | Component | Rule |
| --- | --- | --- |
| Loading | `LoadingRows` | Skeleton sized to what is coming, so the page does not jump |
| Empty | `NothingHere` | Says whether the emptiness is success or a setup step |
| Error | `ErrorState` / `RouteError` | Says what failed, that nothing was lost, and carries the digest |
| Permission | `PermissionState` / `ReadOnlyBanner` | Names a role who can help |
| Disconnected | Per integration | Says what stopped working, not just that a key is missing |

The two that were missing before this system existed are error and permission,
and they are the two where a bad state does the most damage: a failure that
looks like emptiness makes an operator believe they have no work.

## Enforcement

| Rule | Checked by |
| --- | --- |
| No em or en dashes in user-visible source | `tests/no-em-dash.test.ts` |
| No vague statuses (`Pending`, `On track`, ...) | `tests/terminology.test.ts` |
| Spacing scale, theme tokens, type scale | `tests/design-system.test.ts` |
| Every page has a frame and the five states | `npm run inventory` |
| Every mutating route names a capability | `tests/route-permission-coverage.test.ts` |

Contrast, focus order, touch-target size and colour-only status are measured in
the browser rather than statically, because they depend on what actually
renders: `npm run a11y` against a running server, which writes
`docs/accessibility-report.md`. `npm run perf` does the same for render time at
a size the application has not reached yet, writing
`docs/performance-report.md`, and `npm run edge-cases` sweeps every page
against an empty account, a one-record account and one full of long names and
missing values, writing `docs/edge-case-report.md`.
