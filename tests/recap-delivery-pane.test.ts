import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The recap settings page, as a workspace rather than a scroll.
 *
 * Checked in source because both changes are structural: which node the layout
 * hands a narrow screen, and whether the stored mail is served through a route
 * that scopes it to the caller's own account. Neither shows up in rendered
 * output, and both are the kind of thing a later edit undoes without noticing.
 */

const FORM = readFileSync("components/recap-settings-form.tsx", "utf8");
const ROUTE = readFileSync("app/api/recap/deliveries/[id]/html/route.ts", "utf8");

describe("the delivery history pane", () => {
  it("shows the mail that was actually sent, not a rebuilt one", () => {
    // The stored copy, by delivery id. A fresh build would describe a
    // different day, which is the whole reason the copy is kept.
    expect(FORM).toContain("src={`/api/recap/deliveries/${selected.id}/html`}");
  });

  it("sandboxes it, the same way the live preview is sandboxed", () => {
    // Mail rendered from a store, on our own page. No script, no origin.
    expect(FORM.match(/sandbox=""/g)?.length ?? 0).toBe(2);
  });

  it("starts closed on a phone, because its selection has no URL to return to", () => {
    /*
     * The selection is client state deliberately: it sits inside a form
     * holding unsaved edits, and navigating to carry it in the URL would throw
     * them away. That makes the phone rule stricter -- there is no back to go
     * to, so the pane must not open on arrival and must carry its own way out.
     */
    expect(FORM).toContain("const [opened, setOpened] = useState(false);");
    expect(FORM).toContain('className={`${opened ? "hidden lg:block" : "block"}');
    expect(FORM).toContain('className={`${opened ? "block" : "hidden lg:block"}');
    expect(FORM).toMatch(/onClick=\{\(\) => setOpened\(false\)\}[\s\S]{0,120}lg:hidden/);
  });

  it("keeps the retry beside the mail it would resend", () => {
    expect(FORM).toContain("onClick={() => retry(selected.id)}");
  });

  it("hides the retry from a reader who cannot act on it", () => {
    expect(FORM).toContain("canRetry(selected) && !readOnly");
  });
});

describe("the stored copy is served scoped to its own account", () => {
  it("refuses an id that is not a uuid before touching the database", () => {
    expect(ROUTE).toContain("if (!/^[0-9a-f-]{36}$/i.test(params.id))");
  });

  it("answers 404 rather than 403 for somebody else's delivery", () => {
    // A distinguishable refusal would confirm that a guessed id is real.
    expect(ROUTE).toContain("if (!existing || existing.orgId !== orgId)");
    expect(ROUTE).toContain('{ error: "No such delivery." }, { status: 404 }');
  });

  it("never serves it from a cache", () => {
    expect(ROUTE).toContain('"Cache-Control": "no-store"');
  });

  it("says so when there is no saved copy, rather than rendering a blank", () => {
    expect(ROUTE).toContain("if (!existing.html)");
    expect(ROUTE).toContain("No copy of this one was saved");
  });
});

describe("the settings rail", () => {
  it("names every section it can jump to", () => {
    for (const id of [
      "recap-send",
      "recap-sections",
      "recap-recipients",
      "recap-urgent",
      "recap-preview",
      "recap-history",
    ]) {
      expect(FORM).toContain(`<section id="${id}"`);
      expect(FORM).toContain(`id: "${id}"`);
    }
  });

  it("is a wide-screen device only", () => {
    // On a phone the sections are already one column in reading order; a rail
    // above them is a second list to scroll past before reaching the first.
    expect(FORM).toContain('aria-label="Recap settings"');
    expect(FORM).toMatch(/aria-label="Recap settings"[\s\S]{0,200}hidden lg:sticky/);
  });

  it("shows exactly one Save button at any width", () => {
    /*
     * The rail carries it on a wide screen and the inline row carries it on a
     * narrow one. Two in view is a page somebody presses twice.
     */
    const saves = FORM.match(/\{saving \? "Saving\.\.\." : "Save settings"\}/g) ?? [];
    expect(saves.length).toBe(2);
    expect(FORM).toContain('className="flex flex-wrap items-center gap-3 lg:hidden"');
    expect(FORM).toMatch(/hidden lg:sticky[\s\S]*Save settings/);
  });

  it("puts the state that would make you pick a section next to its name", () => {
    expect(FORM).toContain("sendsNeedingADecision");
    expect(FORM).toContain("members.filter((m) => m.receiving).length");
  });
});
