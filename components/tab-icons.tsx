/**
 * The five bottom-tab icons, drawn rather than typed.
 *
 * They were text glyphs: a sun for Today, a grid for Opportunities, an
 * envelope, an ellipsis, and, for Subcontractors, `☰`, which is the hamburger
 * character. That last one is specifically what the brief rules out, and the
 * reason generalises to all five.
 *
 * A glyph renders in whatever the device has. `☀︎` is a variation-selected
 * character that some Android font stacks draw as a filled emoji sun in full
 * colour and others draw as nothing at all; `▤` is missing from enough
 * fallback fonts to show as a box. The tab bar is the one piece of chrome that
 * is on screen for the entire session, so a missing glyph is a permanently
 * broken control rather than a moment of ugliness.
 *
 * They are also the wrong size. Glyph metrics vary per font, so five icons
 * typed at the same font-size land at five different optical weights and
 * baselines, which is why the old bar looked slightly crooked and could not be
 * fixed by adjusting the CSS.
 *
 * Every icon here is 24px on a 24px grid, `currentColor` so it inherits the
 * active and inactive states, and `aria-hidden` because the visible label
 * beneath it is the accessible name. None of them carries meaning the label
 * does not.
 */

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A sun: the day's work. */
export function TodayIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

/** A stack of documents: the bids. */
export function OpportunitiesIcon() {
  return (
    <Icon>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  );
}

/**
 * Two people: the subcontractors.
 *
 * Deliberately not three lines. The hamburger means "menu" everywhere else on
 * every device an operator owns, and using it for a roster of companies makes
 * the one tab they need most look like the one that opens a drawer.
 */
export function SubsIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

/** A handset: the call queue. */
export function CallsIcon() {
  return (
    <Icon>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </Icon>
  );
}

/** Three dots: everything else. The one place the ellipsis is honest. */
export function MoreIcon() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}
