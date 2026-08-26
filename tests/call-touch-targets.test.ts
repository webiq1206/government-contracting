import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The call workspace holds its own touch-target floor, because the sweep
 * cannot check it.
 *
 * `npm run a11y` measures rendered pages, and the call workspace only renders
 * when the account has a call card waiting. A seeded account has none, so the
 * sweep signed in, found an empty queue, measured the empty state, and
 * reported no findings for a page it had never actually opened. Six controls
 * sat under 44 pixels behind that: the answer buttons, the confidence row, and
 * the two header controls.
 *
 * These are also the worst controls in the product to get wrong. They are
 * pressed one-handed with a phone against an ear, while somebody is talking,
 * and a mis-tap on a yes/no records the opposite of what was said.
 *
 * A source check is a weaker instrument than a measurement: it confirms the
 * floor is declared, not that the rendered box clears 44. It is here because
 * the alternative is nothing. Seeding a call card for the sweep would measure
 * the real thing, and is the better fix whenever the sweep grows fixtures.
 */
const ONE_HANDED = [
  {
    file: "components/call-answer.tsx",
    what: "the answer buttons (yes/no and choice)",
    count: 1,
  },
  {
    file: "components/call-workspace.tsx",
    what: "the close control, the brief toggle, and the confidence row",
    count: 3,
  },
];

describe("controls pressed while on a call", () => {
  for (const { file, what, count } of ONE_HANDED) {
    it(`${file}: ${what} declare a 44px floor`, () => {
      const text = readFileSync(file, "utf8");
      /*
       * Class lines only. Counting every `min-h-11` in the file counts the
       * prose explaining it too, which makes the number move when a comment
       * is reworded and says nothing about the buttons.
       */
      const declared = text
        .split("\n")
        .filter((l) => l.includes("className") && l.includes("min-h-11"));
      expect(declared.length).toBe(count);
    });

    it(`${file}: nothing releases the floor below the md breakpoint`, () => {
      /*
       * `md:min-h-0` is how a control returns to its compact desktop size, and
       * it is correct. `sm:min-h-0` would not be: 640 pixels wide is still a
       * phone held sideways, and the hand has not changed.
       */
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("sm:min-h-0");
      expect(text).not.toContain("sm:min-w-0");
    });
  }

  it("the brief toggle has a width floor as well as a height one", () => {
    /*
     * Its label is one short word, so a text button is 28 pixels wide however
     * tall it is. Height alone left it at 28 by 44 and still a miss.
     */
    const text = readFileSync("components/call-workspace.tsx", "utf8");
    const line = text
      .split("\n")
      .find((l) => l.includes("hover:underline") && l.includes("min-h-11"));
    expect(line).toBeDefined();
    expect(line).toContain("min-w-11");
  });
});
