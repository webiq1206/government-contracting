import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The abort confirmation, which is the one control on this product that
 * cannot be undone.
 *
 * `window.confirm` was the tempting implementation and is the wrong one twice
 * over. It records nothing, and the question it asks, "are you sure", is not
 * the question the operator has. Theirs is: what stops, what has already gone
 * out that I cannot take back, and what is kept.
 *
 * So what is asserted here is that the four pursuit decisions stay distinct on
 * screen, and that the destructive one is not reachable in a click.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { PursuitControls } = await import("../components/pursuit-controls");

const impact = {
  title: "Roof replacement, Building 12",
  solicitationNumber: "N4008526R0031",
  deadline: "2026-04-01T17:00:00Z",
  stage: "outreach",
  stops: [
    { label: "Queued outreach emails", count: 4 },
    { label: "Calls in the queue", count: 2 },
  ],
  stands: [{ label: "Emails already delivered", count: 7 }],
  retained: ["quotes", "replies", "documents", "the activity log"],
  confirmPhrase: "N4008526R0031",
};

function render(state: "active" | "paused" | "aborted", canControl = true) {
  return renderToStaticMarkup(
    <PursuitControls
      opportunityId="opp-1"
      state={state}
      impact={impact}
      canControl={canControl}
    />
  );
}

describe("the pursuit controls", () => {
  it("keeps pause and abort as separate offers on an active pursuit", () => {
    const html = render("active");
    expect(html).toContain("Pause this pursuit");
    expect(html).toContain("Abort pursuit");
    // Pausing and aborting are different decisions and the screen must not
    // present one as a stronger version of the other.
    expect(html).not.toContain("Restart pursuit");
  });

  it("offers a restart rather than a resume once aborted", () => {
    const html = render("aborted");
    expect(html).toContain("Restart pursuit");
    // Resuming would silently reactivate work built against a solicitation
    // that may have been amended twice since.
    expect(html).not.toContain("Resume");
  });

  it("offers a resume on a pause, because nothing was thrown away", () => {
    const html = render("paused");
    expect(html).toContain("Resume");
  });

  it("shows nothing to somebody who may not make the decision", () => {
    expect(render("active", false)).toBe("");
  });

  it("does not put the abort confirmation one click away", () => {
    const html = render("active");
    // The counts, the reason list and the typed confirmation all live behind
    // the first click. A destructive control that commits on one press is the
    // shape of this that loses a bid.
    expect(html).not.toContain("Type ");
    expect(html).not.toContain("Queued outreach emails");
  });
});
