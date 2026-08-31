import { describe, expect, it } from "vitest";
import { isTypingTarget, matchesCombo, shouldRunPlainKey } from "@/lib/domain/keyboard";

const NOTHING = { key: "j" };
const INPUT = { tagName: "INPUT" };
const TEXTAREA = { tagName: "TEXTAREA" };
const SELECT = { tagName: "SELECT" };
const DIV = { tagName: "DIV" };
const EDITABLE = { tagName: "DIV", isContentEditable: true };

describe("what counts as typing", () => {
  it("counts the three form controls, whatever their case", () => {
    expect(isTypingTarget(INPUT)).toBe(true);
    expect(isTypingTarget(TEXTAREA)).toBe(true);
    expect(isTypingTarget(SELECT)).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });

  it("counts a contenteditable, which has no special tag name", () => {
    expect(isTypingTarget(EDITABLE)).toBe(true);
  });

  it("does not count an ordinary element", () => {
    expect(isTypingTarget(DIV)).toBe(false);
  });

  it("survives a null target and a target with no tag name", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe("plain letter shortcuts", () => {
  it("run on the page", () => {
    expect(shouldRunPlainKey({}, DIV)).toBe(true);
  });

  it("never run inside a field", () => {
    /*
     * The whole reason this module exists: J typed into a pass-reason box
     * used to move the queue on, losing the note and the record it was about
     * in one keystroke, with no undo.
     */
    expect(shouldRunPlainKey({}, TEXTAREA)).toBe(false);
  });

  it("never run while a modifier is held, so browser shortcuts still work", () => {
    expect(shouldRunPlainKey({ metaKey: true }, DIV)).toBe(false);
    expect(shouldRunPlainKey({ ctrlKey: true }, DIV)).toBe(false);
    expect(shouldRunPlainKey({ altKey: true }, DIV)).toBe(false);
  });
});

describe("written combinations", () => {
  it("treats mod as Command and as Control", () => {
    expect(matchesCombo("mod+Enter", { key: "Enter", metaKey: true }, DIV)).toBe(true);
    expect(matchesCombo("mod+Enter", { key: "Enter", ctrlKey: true }, DIV)).toBe(true);
  });

  it("does not fire without the modifier it names", () => {
    expect(matchesCombo("mod+Enter", { key: "Enter" }, DIV)).toBe(false);
  });

  it("fires inside a field, because that is where the form being saved is", () => {
    expect(matchesCombo("mod+Enter", { key: "Enter", metaKey: true }, TEXTAREA)).toBe(true);
  });

  it("holds shift only when the combination asks for it", () => {
    expect(matchesCombo("mod+Enter", { key: "Enter", metaKey: true, shiftKey: true }, DIV)).toBe(
      false
    );
    expect(
      matchesCombo("mod+shift+Enter", { key: "Enter", metaKey: true, shiftKey: true }, DIV)
    ).toBe(true);
  });

  it("refuses alt, which belongs to the operating system", () => {
    expect(matchesCombo("mod+Enter", { key: "Enter", metaKey: true, altKey: true }, DIV)).toBe(
      false
    );
  });

  it("matches the key case-insensitively", () => {
    expect(matchesCombo("mod+s", { key: "S", metaKey: true }, DIV)).toBe(true);
  });

  it("ignores an empty combination rather than matching everything", () => {
    expect(matchesCombo("", NOTHING, DIV)).toBe(false);
  });
});
