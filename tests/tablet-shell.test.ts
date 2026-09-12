import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NAV = readFileSync("components/nav.tsx", "utf8");
const DASH_SHELL = readFileSync("app/(dash)/layout.tsx", "utf8");
const ACCOUNT_SHELL = readFileSync("app/(account)/layout.tsx", "utf8");
const VIEWPORT = readFileSync("components/app-viewport.tsx", "utf8");
const NAVIGATION = readFileSync("lib/navigation.ts", "utf8");
const CSS = readFileSync("app/globals.css", "utf8");
const SIMPLE_CSS = readFileSync("app/simplified-shell.css", "utf8");

describe("the simplified application shell", () => {
  it("uses one mobile navigation layer, not a persistent bottom tab bar", () => {
    expect(DASH_SHELL).not.toContain("MobileTabBar");
    expect(DASH_SHELL).not.toContain("DashboardTabs");
    expect(ACCOUNT_SHELL).not.toContain("MobileTabBar");
    expect(ACCOUNT_SHELL).not.toContain("DashboardTabs");
    expect(NAV).toContain('aria-label="Open menu"');
    expect(NAV).toContain("fixed inset-y-0 right-0");
  });

  it("keeps tablet portrait on the compact drawer until lg", () => {
    expect(NAV).toContain("lg:sticky");
    expect(NAV).toContain("lg:w-[220px]");
    expect(NAV).not.toContain("md:");
    expect(VIEWPORT).toContain("lg:flex-row");
  });

  it("lets the document own mobile scrolling and removes bottom-tab clearance", () => {
    expect(VIEWPORT).toContain("min-h-dvh");
    expect(VIEWPORT).not.toContain("fixed inset-0");
    expect(SIMPLE_CSS).toContain("padding-bottom: 0 !important");
    expect(SIMPLE_CSS).toContain("overflow: visible !important");
  });

  it("keeps only the primary work destinations visible at top level", () => {
    for (const label of ["Today", "Opportunities", "My Work", "Subcontractors", "Inbox"]) {
      expect(NAVIGATION).toContain(`label: \"${label}\"`);
    }
    const primary = NAVIGATION.slice(
      NAVIGATION.indexOf('key: "primary"'),
      NAVIGATION.indexOf('key: "manage"')
    );
    expect(primary).not.toContain('label: "Calls"');
    expect(primary).not.toContain('label: "Review"');
    expect(NAVIGATION).toContain('pathname === "/review"');
    expect(NAVIGATION).toContain('pathname === "/call-queue"');
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
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (/md:min-h-0/.test(readFileSync(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders, `use lg:min-h-0: ${offenders.join(", ")}`).toEqual([]);
  });

  it("is not switched off in the design system either", () => {
    expect(CSS).not.toContain("min-width: 768px");
  });
});

describe("scrollable tab strips", () => {
  it("keeps tabs from shrinking into each other", () => {
    const rule = CSS.slice(CSS.indexOf(".dash-tab {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("shrink-0");
  });

  it("scrolls a remaining record-level strip rather than wrapping it", () => {
    const src = readFileSync(join(process.cwd(), "components/editorial-tabs.tsx"), "utf8");
    expect(src).toContain("overflow-x-auto");
    expect(src).not.toContain("flex-wrap");
  });
});

describe("a table too wide for a phone", () => {
  const table = () => readFileSync(join(process.cwd(), "components/data-table.tsx"), "utf8");
  const subs = () => readFileSync(join(process.cwd(), "components/subs-table.tsx"), "utf8");

  it("hides the table where cards take over, rather than showing both", () => {
    expect(table()).toContain('card ? " hidden lg:block" : ""');
  });

  it("leaves the table alone on a page with no card", () => {
    expect(table()).toContain("card?: (row: T) => React.ReactNode;");
  });

  it("hides column and density controls where cards are in charge", () => {
    expect(table()).toContain('card ? " hidden lg:flex" : ""');
  });

  it("keeps roster contact actions inside the card", () => {
    const src = subs();
    expect(src).toContain("border-t border-border");
    expect(src).not.toMatch(/fixed\s+bottom-/);
  });

  it("never offers to email an address that has not passed verification", () => {
    expect(subs()).toContain("row.email && row.email_verified ? `mailto:");
  });

  it("gives every contact action a full tap target", () => {
    const src = subs();
    const bar = src.slice(src.indexOf("The contact bar."));
    const targets = bar.match(/min-h-11/g) ?? [];
    expect(targets.length).toBeGreaterThanOrEqual(5);
  });
});
