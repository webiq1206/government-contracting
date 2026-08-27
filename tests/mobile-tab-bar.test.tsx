import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

/**
 * The bottom bar is the one piece of chrome on screen for the whole session.
 *
 * Which makes its two failure modes expensive out of proportion to their size.
 *
 * A missing glyph is a permanently broken control rather than a moment of
 * ugliness, and the old bar was five typed characters: a variation-selected
 * sun that some Android font stacks draw in full colour and others draw as
 * nothing, a grid character missing from enough fallback fonts to show as a
 * box, and, for Subcontractors, the hamburger, which means "menu" on every
 * device an operator owns.
 *
 * And a tab that is not there is a destination nobody finds. Communications
 * came off the bar when Calls took the fourth slot, so the More badge has to
 * carry it.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
}));

const { MobileTabBar } = await import("../components/mobile-tab-bar");

function render(props: { reviewCount: number; callCount: number; inboxCount?: number }) {
  return renderToStaticMarkup(<MobileTabBar {...props} />);
}

describe("the five tabs", () => {
  it("are the five the brief names", () => {
    const html = render({ reviewCount: 0, callCount: 0 });
    for (const label of ["Today", "Opportunities", "Subcontractors", "Calls", "More"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('href="/call-queue"');
  });

  it("draws its icons rather than typing them", () => {
    const html = render({ reviewCount: 0, callCount: 0 });
    expect(html).toContain("<svg");
    // The specific character the brief rules out, and the ones beside it that
    // render differently or not at all depending on the device.
    for (const glyph of ["☰", "☀︎", "▤", "✉"]) {
      expect(html).not.toContain(glyph);
    }
  });

  it("gives every icon an accessible name from the label, not from the drawing", () => {
    const src = readFileSync("components/tab-icons.tsx", "utf8");
    // aria-hidden on the art, a real word underneath it.
    expect(src).toContain("aria-hidden");
    const html = render({ reviewCount: 0, callCount: 0 });
    expect(html).toContain('class="sr-only"');
  });

  it("does not say which tab is current by colour alone", () => {
    const html = render({ reviewCount: 0, callCount: 0 });
    expect(html).toContain('aria-current="page"');
    // And a bar, and a bold weight: three signals, one of which is not colour.
    expect(html).toContain("font-semibold");
  });
});

describe("what the badges count", () => {
  it("puts the whole pending queue on Today, not one slice", () => {
    const html = render({ reviewCount: 3, callCount: 4 });
    expect(html).toContain(">7<");
  });

  it("carries the inbox on More, because it lost its own tab", () => {
    const html = render({ reviewCount: 0, callCount: 0, inboxCount: 5 });
    // Without this, moving Communications off the bar would have hidden the
    // one queue where somebody outside this company is waiting.
    expect(html).toContain(">5<");
    expect(html).toContain("5 waiting");
  });

  it("shows no badge when nothing is waiting", () => {
    const html = render({ reviewCount: 0, callCount: 0, inboxCount: 0 });
    // Zero is not a number worth printing on a tab; an empty badge reads as a
    // fault.
    expect(html).not.toContain("waiting");
  });
});

describe("the menu button", () => {
  it("is drawn too, because it is the way to twenty destinations", () => {
    const src = readFileSync("components/nav.tsx", "utf8");
    // On a phone the drawer is the only route to everything not on the bar,
    // so a glyph the device does not have is the navigation gone rather than
    // a blemish.
    expect(src).toContain("<MenuIcon />");
    expect(src).toContain("<CloseIcon />");
    expect(src).not.toContain("☰");
    expect(src).not.toContain("✕");
  });
});

describe("the destination that lost its tab", () => {
  it("is still reachable from More", () => {
    const src = readFileSync("app/(dash)/more/page.tsx", "utf8");
    expect(src).toContain('href: "/communications"');
  });
});
