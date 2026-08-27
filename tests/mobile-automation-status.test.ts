import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The automation status at the top of the phone drawer.
 *
 * It read one Boolean: whether somebody had pressed Pause. So an account whose
 * every job was failing on an exhausted credit balance was told "Automation
 * running. Agents and scheduled jobs are live", which is the same sentence the
 * sidebar chip was rebuilt to stop saying, still being said one breakpoint
 * away.
 *
 * The Boolean and the health state answer different questions. "Did anybody
 * press Pause" is not "is the work getting done": an account with no AI key is
 * not paused and is not working.
 */

const SRC = readFileSync("components/nav.tsx", "utf8");

describe("the mobile automation strip", () => {
  it("reads the health state rather than the pause Boolean", () => {
    // The strip renders one computed headline, and that headline starts from
    // the measured state.
    expect(SRC).toContain("<p className=\"text-sm font-medium text-foreground\">{mobileHeadline}</p>");
    const definition = SRC.slice(SRC.indexOf("const mobileHeadline"), SRC.indexOf("const mobileDetail"));
    expect(definition).toContain("automationHeadline ??");
    /*
     * The old sentences survive as the last-resort fallback for an account
     * whose health has not been measured yet, which is honest. What must not
     * survive is a Boolean choosing between them on its own, so the fallback
     * has to sit behind the `??` above rather than in front of it.
     */
    expect(definition.indexOf("automationHeadline")).toBeLessThan(
      definition.indexOf('"Automation paused"')
    );
  });

  it("says which of the five states it is in, in words and a glyph", () => {
    // Never colour alone: the chip glyph carries it too, and it is the same
    // glyph table the sidebar uses so the two cannot drift.
    expect(SRC).toContain("CHIP_GLYPH[mobileState]");
  });

  it("lets the Boolean win only while the toggle is in flight", () => {
    /*
     * That window is the one time the measured state is stale by construction:
     * it describes the account as it was before the button was pressed.
     */
    expect(SRC).toContain("const togglePending = localPaused !== automationPaused");
    expect(SRC).toContain("Pausing automation");
  });

  it("refreshes so the measured state catches up", () => {
    /*
     * Without this the optimistic Boolean and the health state disagree until
     * the next navigation. Resuming an account whose credits are exhausted has
     * to go back to saying the credits are exhausted, not to saying everything
     * is fine.
     */
    const toggle = SRC.slice(SRC.indexOf("async function handleToggleAutomation"));
    expect(toggle.slice(0, 1200)).toContain("router.refresh()");
  });
});
