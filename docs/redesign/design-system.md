# BrostCo product design system

This document records the redesign on `redesign/complete-platform`. It supersedes earlier color, type, navigation-width, and persistent-mobile-layer guidance in `docs/design-system.md`.

## Tokens and typography

| Role | Light | Dark |
| --- | --- | --- |
| Page | #F4F6F6 | #0B1720 |
| Text | #111A1F | #EFF5F4 |
| Surface | #FFFFFF | #102A33 |
| Secondary text | #617077 | #A8BABC |
| Primary action / focus | #0E6F75 | #53BAC0 |
| Positive status | #2B6F52 | #85C9A3 |
| Attention | #95601B | #E5BC78 |
| Risk | #A33A31 | #F19B92 |

Use semantic Tailwind tokens from `app/globals.css` and `tailwind.config.ts`. Legacy `gold` class names remain compatible aliases to Petrol, not a second brand palette. `on-accent` and `on-status` supply the foreground for solid semantic fills. Quiet card boundaries are distinct from stronger input boundaries.

Inter is the interface face. Manrope supplies 700-weight display headings. System monospace is reserved for structured identifiers. Use 16px form input text, 14px secondary operational text, and readable body copy. Existing small metadata in the app shell has a 12px floor. This is a readability improvement, not a claim that every legacy component has reached a 16px body target.

Keep spacing on the existing compact scale. Controls generally have a 44px minimum height, and coarse-pointer overrides preserve it when responsive utility classes compress controls. Verify actual targets and spacing in the browser; CSS rules alone do not prove accessibility.

## Navigation and page structure

Desktop navigation is 232px. Its groups come from `lib/navigation.ts`, which also defines selection matching and parent destinations for records. Root mobile tabs use Today, Pipeline, Subs, Calls, and More; Pipeline and Subs have full accessible names. The shorter visible labels avoid clipping at 320px.

Use this hierarchy on work pages: identity and purpose; current problem or next task; primary working surface; optional evidence and configuration. Search is immediately available. Advanced filters belong in a disclosure or sheet with their active state still understandable.

At 2xl, a workspace can place evidence beside its active record; at smaller sizes, the evidence stacks below it. Keep queue rails at 320px, expanding to 360px on the largest shared layout. Do not impose three competing columns on a narrow laptop.

Mobile records have a parent breadcrumb/back link and one bottom action layer. Global tabs disappear on focused records or open call workspaces. Ordinary workspace footers stay in flow on phones. Record section tabs are not sticky on mobile. Profile saves are sticky only while dirty, saving, or reporting a save error.

## Shared behavior

- `PageHeader` supplies compact titles, explanations, and actions.
- `FilterToolbar` and `QueueFilters` reveal optional criteria without concealing search.
- `WorkspaceShell` handles the queue, active record, optional context, and footer.
- `EditorialTabs` and `revealEditorialTarget` coordinate tabs, hash targets, and containing disclosures.
- `NextStepBanner` presents the action and its effect. The utility status bar does not duplicate the primary CTA.
- Existing quick views, confirmations, unsaved-change guards, role controls, recovery panels, and source access remain attached to their real domain actions.
- “Guide me” remains guidance. It is not renamed to imply a conversational AI capability it does not implement.

Status color always needs a readable label or icon. Focus uses the primary semantic color with an offset. Honor reduced motion and preserve keyboard behavior. Do not substitute a fake percentage for an unknown job state.

## Public site and media

The public site uses Midnight navigation and hero surfaces, cool light-gray content, white cards, and Petrol actions. Primary and destructive buttons retain a fixed dark fill and white text in both themes. Aqua identifies automation; Brass identifies attention, neither substitutes for a primary action. It explains a small number of meaningful outcomes before detailed capabilities. The signup CTA is primary; the product demonstration is secondary.

Videos play deliberately with native controls, inline support, captions, posters, and transcripts. No sound autoplays. Gallery selection unmounts the prior video so two gallery clips cannot keep playing. Current assets are honestly labeled guided screen previews with sample data. Live interaction footage remains a release requirement.

## Current completion pass

The always-dark sidebar scopes its own tokens and uses the approved white logo. It does not force dark surfaces onto the light application header. Essential secondary text and input outlines have tested contrast in both modes. Control outlines use #82918F on light and #6F8B8F on dark surfaces, rather than decorative low-contrast card borders.

The opportunity page includes read-only, explicitly requested AI questions. The server rebuilds authorized facts, returns links to the records checked, and does not treat a workflow summary as a full source-document review. No question sends a message, changes a record, or submits a bid. API usage rules are unchanged.

Activity filters remain visible as individually removable chips, including hidden attention constraints. Browser history retains the view. Video failures offer a retry and transcript; native controls, captions and deliberate playback remain in place.
