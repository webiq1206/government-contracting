/**
 * When a keystroke belongs to the page and when it belongs to whatever the
 * person is typing into.
 *
 * The rule is small and the cost of getting it wrong is not. A queue that
 * jumps to the next record because somebody typed "j" in a pass-reason box
 * loses the note AND the record it was about, in one keystroke, with no
 * undo. So the decision lives here, as a pure function over the properties of
 * the element, and is tested rather than eyeballed inside an effect.
 *
 * Deliberately a shape rather than an Element: this is called with a DOM node
 * in the browser and with a plain object in the tests, and nothing in it needs
 * anything a real element provides.
 */
export interface FocusTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

const TYPING_TAGS = new Set(["input", "textarea", "select"]);

export function isTypingTarget(target: FocusTarget | null | undefined): boolean {
  if (!target || typeof target.tagName !== "string") return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has(target.tagName.toLowerCase());
}

/**
 * Whether a plain-letter shortcut such as J or K should act.
 *
 * Modifier-held combinations are handled separately and deliberately: see
 * `matchesCombo`.
 */
export function shouldRunPlainKey(
  event: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
  target: FocusTarget | null | undefined
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return !isTypingTarget(target);
}

/**
 * Whether a written combination such as "mod+Enter" matches this event.
 *
 * "mod" is Command on a Mac and Control everywhere else, which is why it is
 * written as one token rather than as two bindings.
 *
 * A modifier combination fires even inside a field, and that is the point:
 * "save this and move on" is exactly what somebody wants at the end of filling
 * in the box they are still standing in. Refusing it there would make the
 * shortcut useless on every form in the product.
 */
export function matchesCombo(
  combo: string,
  event: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  target?: FocusTarget | null
): boolean {
  const parts = combo.toLowerCase().split("+").filter(Boolean);
  if (parts.length === 0) return false;
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const key = parts[parts.length - 1];

  const mod = Boolean(event.metaKey || event.ctrlKey);
  if (wantMod !== mod) return false;
  if (wantShift !== Boolean(event.shiftKey)) return false;
  if (event.altKey) return false;
  if (event.key.toLowerCase() !== key) return false;
  if (!wantMod && isTypingTarget(target)) return false;
  return true;
}
