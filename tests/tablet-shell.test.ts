import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the sidebar starts, and what moves with it.
 *
 * At the `md` breakpoint the sidebar was 256px on a 768px screen: a third of
 * an iPad in portrait spent on navigation, on the device whose content column
 * is already the tightest. A table that fits at 768 does not fit at 512.
 *
 * The brief offers two ways out, a compact icon rail or keeping the bottom bar
 * until the wider breakpoint. The rail is the wrong one here: twenty-five
 * destinations in eight named groups is either twenty-five glyphs, which is
 * unreadable and is exactly what the tab-bar icons were rescued from, or
 * groups behind hover, which a tablet does not have.
 *
 * So tablet portrait is a touch layout, and this pins the parts that have to
 * agree about that. They are in five files, and a diff that moves one of them
 * back to `md` produces a screen with both a sidebar and a bottom tab bar, or
 * a page whose last row sits under the bar.
 */

const NAV = readFileSync("components/nav.tsx", "utf8");
const BAR = readFileSync("components/mobile-tab-bar.tsx", "utf8");
const SHELL = readFileSync("app/(dash)/layout.tsx", "utf8");
const CSS = readFileSync("app/globals.css", "utf8");

describe("the shell", () => {
  it("puts the sidebar at lg, not md", () => {
    expect(NAV).toContain("lg:static");
    expect(NAV).toContain("lg:w-64");
    // Not one leftover: a single md: in this file is a sidebar that half
    // appears, or a drawer header that vanishes while the drawer is still the
    // only way to navigate.
    expect(NAV).not.toContain("md:");
  });

  it("keeps the bottom tabs until the sidebar arrives", () => {
    expect(BAR).toContain("lg:hidden");
    expect(BAR).not.toContain("md:hidden");
    // Both at once is the failure this pair produces: a tablet with a sidebar
    // AND five tabs, navigating to the same places.
    expect(SHELL).toContain("lg:flex-row");
  });

  it("leaves room for the bar for exactly as long as the bar is there", () => {
    /*
     * .page-main's bottom padding IS the bar. Ending it at 768 while the bar
     * runs to 1024 puts the last row of every page underneath it, which reads
     * as the list simply stopping there.
     */
    const rule = CSS.slice(CSS.indexOf(".page-main"));
    const media = rule.slice(0, rule.indexOf("padding-bottom: 0"));
    expect(media).toContain("min-width: 1024px");
    expect(media).not.toContain("min-width: 768px");
  });
});

describe("the touch-target minimum", () => {
  const ROOTS = ["components", "app"];
  const SKIP = new Set(["node_modules", ".next", "dist"]);

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (full.endsWith(".tsx")) yield full;
    }
  }

  it("is not switched off before the layout stops being a touch one", () => {
    /*
     * `md:min-h-0` on a 44px control drops it to its natural height at 768,
     * which is now a width somebody is tapping with a thumb. Fifty of these
     * were written when 768 meant "mouse".
     */
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (/md:min-h-0/.test(readFileSync(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders, `use lg:min-h-0: ${offenders.join(", ")}`).toEqual([]);
  });

  it("is not switched off in the design system either", () => {
    // The .btn family, .btn-secondary and .shell-ghost each had their own
    // 768px escape hatch, which is the same rule failing three more times.
    expect(CSS).not.toContain("min-width: 768px");
  });
});

/**
 * A tab strip that overflows must scroll, not crush.
 *
 * Flex items shrink by default. Seven tabs in a 390px row compressed into each
 * other, and on the opportunity workspace the labels overlapped into one
 * unreadable line: the strip is the only way to reach six of the seven
 * sections on a phone, so this was six sections unreachable by anybody who
 * could not guess where to tap.
 *
 * The utility lives in `.dash-tab` rather than at each call site because it
 * was already present at one of them and forgotten at the other, which is the
 * shape of a rule that gets forgotten again.
 */
describe("scrollable tab strips", () => {
  it("keeps tabs from shrinking into each other", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const rule = css.slice(css.indexOf(".dash-tab {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("shrink-0");
  });

  it("scrolls the strip rather than wrapping it", () => {
    // overflow-x-auto with shrink-0 is the pair that makes it work; wrapping
    // instead would push the page content down by a row on every phone.
    const src = readFileSync(join(process.cwd(), "components/editorial-tabs.tsx"), "utf8");
    expect(src).toContain("overflow-x-auto");
    expect(src).not.toContain("flex-wrap");
  });
});

/**
 * A 52rem table on a 390px screen.
 *
 * The roster table sits inside a horizontal scroller, so reading one row on a
 * phone meant scrolling sideways until the company name had left the screen,
 * with the state badge and the way to reach them at opposite ends of that
 * scroll. Cards are not a smaller table: they are a different arrangement of
 * the same row.
 */
describe("a table too wide for a phone", () => {
  const table = () => readFileSync(join(process.cwd(), "components/data-table.tsx"), "utf8");
  const subs = () => readFileSync(join(process.cwd(), "components/subs-table.tsx"), "utf8");

  it("hides the table where cards take over, rather than showing both", () => {
    // Both rendered at once would mean every row twice on a phone, and the
    // page would still scroll sideways.
    expect(table()).toContain('card ? " hidden lg:block" : ""');
  });

  it("leaves the table alone on a page with no card", () => {
    // The conditional is what makes this safe to add one page at a time.
    expect(table()).toContain("card?: (row: T) => React.ReactNode;");
  });

  it("hides the column and density controls where cards are in charge", () => {
    // They change nothing a card reader can see.
    expect(table()).toContain('card ? " hidden lg:flex" : ""');
  });

  it("keeps the roster's contact actions inside the card, not fixed to the screen", () => {
    /*
     * A bar fixed to the viewport can only ever act on one firm, and a list
     * of firms is exactly where somebody is choosing between them.
     */
    const src = subs();
    expect(src).toContain("border-t border-border");
    expect(src).not.toMatch(/fixed\s+bottom-/);
  });

  it("never offers to email an address that has not passed verification", () => {
    // A mailto to an unverified address is how a bid loses a quote to a
    // bounce nobody saw.
    expect(subs()).toContain("row.email && row.email_verified ? `mailto:");
  });

  it("gives every contact action a full tap target", () => {
    const src = subs();
    const bar = src.slice(src.indexOf("The contact bar."));
    const targets = bar.match(/min-h-11/g) ?? [];
    // Call, Email and Quick look, in both their live and their dimmed forms.
    expect(targets.length).toBeGreaterThanOrEqual(5);
  });
});
