import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFiles } from "./helpers/source-files";
import { relative } from "node:path";

/**
 * The rules the three-pane shell only works under.
 *
 * Every one of these is a bug that shipped once during the pass that
 * introduced the shell, was invisible on a desktop, and made the surface
 * unusable on a phone. They are checked in source because the failure is
 * structural: it is which node the layout hands the screen to, not what any
 * of them renders.
 */

const SHELL = readFileSync("components/workspace/workspace-shell.tsx", "utf8");

describe("the workspace shell itself", () => {
  it("renders the context pane exactly once", () => {
    /*
     * The first draft rendered it twice -- once folded under the record for
     * narrow screens, once as an aside for wide ones -- with the wrong copy
     * hidden by a class. Two live copies of a pane containing forms and owner
     * pickers means two client components with the same purpose and one of
     * them silently receiving the clicks.
     */
    expect(SHELL.match(/\{context\}/g)?.length ?? 0).toBe(1);
  });

  it("keeps one pane at a time below the sidebar breakpoint", () => {
    // lg, matching the shell: the bottom tab bar runs to 1024 and a surface
    // that split at 768 would put three columns on a tablet in portrait.
    expect(SHELL).toContain('selected ? "hidden lg:block" : "block"');
    expect(SHELL).toContain('selected ? "flex" : "hidden lg:flex"');
  });

  it("moves the context pane under the record rather than dropping it", () => {
    // Below xl it is a bottom strip, not absent: the things in it are usually
    // the reason a decision goes one way.
    expect(SHELL).toMatch(/xl:w-\[320px\]/);
    expect(SHELL).toMatch(/xl:border-l/);
  });
});

/**
 * Every host of the shell, and the expression it decides the phone's pane
 * from.
 *
 * This is the subtle one. Each of these pages resolves a DEFAULT selection so
 * a wide screen never opens on an empty half. Feeding that resolved value to
 * the shell hides the queue and the page header the moment a phone loads the
 * page, and the only way back points at the URL that just did it: a trap with
 * no exit. The flag has to come from the URL.
 */
const HOSTS: { file: string; flag: string }[] = [
  { file: "app/(dash)/workbench/page.tsx", flag: "const opened = Boolean(selectedKey);" },
  { file: "app/(dash)/contracts/page.tsx", flag: "const opened = Boolean(searchParams?.c);" },
  { file: "app/(dash)/authority/page.tsx", flag: "const opened = Boolean(requested);" },
  { file: "app/(dash)/compliance/page.tsx", flag: "const opened = Boolean(requested);" },
];

describe("which pane a phone gets", () => {
  for (const { file, flag } of HOSTS) {
    it(`${file} decides it from the URL, not from the default selection`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain(flag);
      expect(src).toContain("opened");
    });
  }

  it("Review decides it from its own query parameter", () => {
    // Review predates the shell and names the parameter differently; the rule
    // is the same one.
    const src = readFileSync("app/(dash)/review/page.tsx", "utf8");
    expect(src).toContain("selected={selectedId != null}");
  });

  it("no host feeds a resolved selection to the shell", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("app").concat(sourceFiles("components"))) {
      const src = readFileSync(file, "utf8");
      /*
       * The exact shapes that caused it. A resolved record is named for the
       * record (`selected`, `currentId`, `selectedCard`); the URL flag is
       * named `opened` or is the raw parameter, and those are allowed.
       */
      if (/selected=\{(?:selected|currentId|selectedRow|selectedCard) !== null\}/.test(src)) {
        offenders.push(relative(process.cwd(), file));
      }
      if (/selected=\{(?:selected|currentId|selectedRow|selectedCard) != null\}/.test(src)) {
        offenders.push(relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches the shape it was written for", () => {
    /*
     * Guards the guard. A regex that matches nothing would make the assertion
     * above pass forever, including on the line it exists to catch.
     */
    const bad = "            selected={currentId != null}";
    expect(/selected=\{(?:selected|currentId|selectedRow|selectedCard) != null\}/.test(bad)).toBe(
      true
    );
    expect(/selected=\{(?:selected|currentId|selectedRow|selectedCard) != null\}/.test(
      "selected={opened}"
    )).toBe(false);
  });
});

describe("every workspace offers a way back on a phone", () => {
  /*
   * With the queue and the page header both hidden, a pane with no back link
   * is a screen somebody can only leave with the browser's own control, and on
   * an installed web app there is not always one.
   */
  const PANES = [
    "components/workbench/workbench-panel.tsx",
    "components/compliance-workspace.tsx",
    "app/(dash)/contracts/page.tsx",
    "app/(dash)/authority/page.tsx",
  ];
  for (const file of PANES) {
    it(`${file} has a back control that only shows on a narrow screen`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/lg:hidden/);
    });
  }
});
