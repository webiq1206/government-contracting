import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every editor that holds unsaved work guards it against a click.
 *
 * `beforeunload` is not this guard. It fires when the tab closes, the page is
 * refreshed, or an address is typed, and it does not fire at all for an in-app
 * navigation, which is how people actually leave a page: they click Today in
 * the sidebar. The company profile had that guard and lost a filled-in form to
 * one sidebar click with no prompt; the template editor, the automation rules,
 * the content library and the call workspace had nothing at all.
 *
 * Listed rather than discovered, because "is there unsaved work here" is a
 * judgement about what a form holds, not something a scan can decide. Adding
 * an editor means adding it here, which is the point: the decision gets made
 * once, deliberately, instead of being forgotten.
 */
const EDITORS = [
  "components/profile-editor.tsx",
  "components/email-template-editor.tsx",
  "components/automation-rules-form.tsx",
  "components/content-library-manager.tsx",
  "components/call-workspace.tsx",
];

describe("work that would be lost is guarded", () => {
  for (const file of EDITORS) {
    it(`${file} mounts UnsavedGuard`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("UnsavedGuard");
      // The guard owns the browser prompt now. A second beforeunload listener
      // in an editor means somebody rebuilt half of it and covered only the
      // case that was already covered.
      expect(text).not.toContain("beforeunload");
    });
  }

  it("the guard itself covers both ways of leaving", () => {
    const guard = readFileSync("components/unsaved-guard.tsx", "utf8");
    expect(guard).toContain("beforeunload");
    // Capture phase, or the router claims the click first and navigates.
    expect(guard).toContain('document.addEventListener("click", onClick, true)');
  });
});
