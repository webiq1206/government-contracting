# BrostCo product design system

This document records the current BrostCo product system. It supersedes earlier color, type, navigation-width, and persistent-mobile-layer guidance in `docs/design-system.md`.

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

Use semantic Tailwind tokens from `app/globals.css` and `tailwind.config.ts`. Legacy `gold` class names remain compatible aliases to Petrol, not a second brand palette. `on-accent` and `on-status` supply the foreground for solid semantic fills.

Inter is the interface face. Manrope supplies 700-weight display headings. System monospace is reserved for structured identifiers. Use 16px form input text, 14px secondary operational text, and readable body copy. Controls generally have a 44px minimum height.

## Navigation and page structure

BrostCo uses one global navigation system. It does not stack a mobile menu with a persistent bottom tab bar.

The primary global destinations are intentionally limited to Today, Opportunities, My Work, Subcontractors, and Inbox. Secondary capabilities remain available without being given equal visual weight:

- Manage: Contracts and Compliance.
- Insights & system: Activity, Reports, Daily recap, and Automation.
- Account: Settings, Help, and Feedback.
- Admin: platform-only account, health, audit, billing, usage, invitation, recap, and authority tools.

Calls and Review remain full working routes and preserve their deep links. They are contextual work views reached from Today and My Work rather than permanent global destinations.

Desktop navigation is a compact 220px rail. On mobile and tablet, one 56px application header provides home, search, and menu access. The menu opens as a concise drawer. There is no persistent bottom navigation layer and no navigation count wall.

Use this hierarchy on work pages: identity; current problem or next task; primary working surface; optional evidence and configuration. Advanced filters belong in a disclosure or sheet. Page headers are orientation, not content: one title, one short status line when useful, and at most one primary action.

The document owns vertical scrolling on phones. Workspaces use one pane at a time on mobile and may expand to queue/detail/context panes on larger screens. Avoid nested vertical scrolling except where a desktop workspace or real table requires it. Record and workspace action footers stay in normal flow on phones.

## Operational density rules

- Show the information required to choose or act on a record. Move secondary evidence into Quick look, Details, or the record page.
- Opportunity cards default to title, agency, deadline, meaningful score, one status, and the next action. Confidence, trade coverage, ownership detail, and secondary blockers are not default card chrome.
- Review is a focused decision experience. Show one recommendation, the top reason, deadline, and Pursue/Pass path. Detailed risks and score factors live under Details.
- My Work defaults to Needs you, Waiting, Overdue, Done, plus search and one More filters disclosure.
- Today puts the human queue first. Search/filter controls stay collapsed unless used. System failures are grouped instead of repeated across the page and menu.
- Avoid boxes inside boxes, giant pills, repeated status chips, and all-caps operational labels. Use spacing before borders.

## Shared behavior

- `PageHeader` supplies compact titles, status, optional description, and actions.
- `HelpPopover` is a quiet text utility, not a large circular control.
- `FilterToolbar` and `QueueFilters` reveal optional criteria without concealing the working surface.
- `WorkspaceShell` handles queue, active record, optional context, and footer while preserving mobile document flow.
- `EditorialTabs` and `revealEditorialTarget` coordinate record-level tabs, hash targets, and containing disclosures.
- `NextStepBanner` presents the action and its effect. Utility status does not duplicate the primary CTA.
- Existing quick views, confirmations, unsaved-change guards, role controls, recovery panels, and source access remain attached to their real domain actions.
- Contextual AI remains guidance. It does not imply that a message was sent, a record changed, or a bid submitted unless the underlying action actually occurred.

Status color always needs a readable label or icon. Focus uses the primary semantic color with an offset. Honor reduced motion and preserve keyboard behavior. Do not substitute a fake percentage for an unknown job state.

## Public site and media

The public site uses Midnight navigation and hero surfaces, cool light-gray content, white cards, and Petrol actions. Primary and destructive buttons retain a fixed dark fill and white text in both themes. Aqua identifies automation; Brass identifies attention, neither substitutes for a primary action. The signup CTA is primary; the product demonstration is secondary.

Videos play deliberately with native controls, inline support, captions, posters, and transcripts. No sound autoplays. Gallery selection unmounts the prior video so two gallery clips cannot keep playing.

## Current completion pass

The always-dark desktop sidebar scopes its own tokens and uses the approved white logo. It does not force dark surfaces onto the light application header. Essential secondary text and input outlines have tested contrast in both modes.

The opportunity page includes read-only, explicitly requested AI questions. The server rebuilds authorized facts, returns links to the records checked, and does not treat a workflow summary as a full source-document review. No question sends a message, changes a record, or submits a bid.

Activity filters remain visible as individually removable chips, including hidden attention constraints. Browser history retains the view. Video failures offer a retry and transcript; native controls, captions, and deliberate playback remain in place.
