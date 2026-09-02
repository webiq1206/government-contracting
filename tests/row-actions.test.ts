import { describe, expect, it } from "vitest";
import {
  callCardRowActions,
  conversationRowActions,
  opportunityRowActions,
  requestInfoMessage,
  splitRowActions,
  subcontractorRowActions,
  workItemRowActions,
} from "@/lib/domain/row-actions";

/**
 * What a row offers, and to whom.
 *
 * Every list in the product used to answer this for itself, so the same
 * subcontractor could be stopped from one screen and not another, and whether
 * a control was allowed depended on which component happened to draw it. The
 * rules live in one module now, and these are the rules: an action the role
 * cannot perform is absent rather than greyed out, an action that makes no
 * sense for the record's state is absent too, and the handful that cannot be
 * taken back have to say so first.
 */

const owner = { role: "owner" };
const viewerOnly = { role: "viewer" };

function keys(actions: { key: string }[]): string[] {
  return actions.map((a) => a.key);
}

describe("who is allowed to act from a row", () => {
  it("offers a read-only member nothing on an opportunity", () => {
    /*
     * Absent rather than disabled. A greyed-out Pursue is a promise the
     * server is going to break, and the person clicking it learns that the
     * product lies rather than that they lack a permission.
     */
    expect(opportunityRowActions({ id: "o1", stage: "scoring" }, viewerOnly)).toEqual([]);
  });

  it("offers a read-only member nothing on a call, a conversation or a firm", () => {
    expect(callCardRowActions({ id: "c1", companyName: "Alpha" }, viewerOnly)).toEqual([]);
    expect(
      conversationRowActions(
        {
          threadKey: "t1",
          subcontractorId: "s1",
          subcontractorName: "Alpha",
          openHref: "/communications?c=t1",
        },
        viewerOnly
      )
    ).toEqual([]);
    expect(
      keys(
        subcontractorRowActions(
          { id: "s1", companyName: "Alpha", email: "a@b.com", emailVerified: true },
          viewerOnly
        )
      )
    ).not.toContain("email_sub");
  });

  it("still lets a read-only member ring a number they can already see", () => {
    // The phone number is on the row either way. Hiding the dialler while
    // showing the digits is a rule that protects nothing.
    expect(
      keys(subcontractorRowActions({ id: "s1", companyName: "Alpha", phone: "555-0100" }, viewerOnly))
    ).toEqual(["call_sub"]);
  });

  it("offers re-running a stage to everyone the endpoint would let re-run it", () => {
    /*
     * The action route authorizes a re-run on `decide`, which a team member
     * has. Gating the row on `run_agents` because the name sounded right
     * would have hidden a working button from the people who meet a stalled
     * score most often, and hiding a permitted action reads as a broken
     * product rather than as a rule.
     */
    const teamMember = { role: "member" };
    const forMember = keys(opportunityRowActions({ id: "o1", stage: "analysis" }, teamMember));
    expect(forMember).toContain("rerun");
    expect(keys(opportunityRowActions({ id: "o1", stage: "analysis" }, viewerOnly))).not.toContain(
      "rerun"
    );
  });
});

describe("what the record's own state rules out", () => {
  it("offers nothing on a bid that has been won", () => {
    expect(opportunityRowActions({ id: "o1", stage: "won" }, owner)).toEqual([]);
  });

  it("offers a passed record exactly one way back and nothing else", () => {
    expect(keys(opportunityRowActions({ id: "o1", stage: "dismissed" }, owner))).toEqual([
      "restore",
    ]);
  });

  it("treats an archived status as closed even when the stage still reads live", () => {
    // A pass archives the record; the stage it was passed at stays. Reading
    // the stage alone put a full menu on a record somebody had already
    // decided about.
    expect(
      opportunityRowActions({ id: "o1", stage: "analysis", status: "archived" }, owner)
    ).toEqual([]);
  });

  it("does not offer to pursue a bid that is already being built", () => {
    const built = keys(opportunityRowActions({ id: "o1", stage: "bid_building" }, owner));
    expect(built).not.toContain("pursue");
    expect(built).toContain("abort_bid");
  });

  it("does not offer to abort a bid that has already gone in", () => {
    expect(keys(opportunityRowActions({ id: "o1", stage: "submitted" }, owner))).not.toContain(
      "abort_bid"
    );
  });

  it("does not offer to abort a pursuit that is already aborted", () => {
    expect(
      keys(
        opportunityRowActions(
          { id: "o1", stage: "outreach", pursuitState: "aborted" },
          owner
        )
      )
    ).not.toContain("abort_bid");
  });

  it("swaps snoozing for waking on a record that is already put away", () => {
    const snoozed = keys(
      opportunityRowActions({ id: "o1", stage: "analysis", snoozedUntil: "2026-09-04" }, owner)
    );
    expect(snoozed).toContain("wake");
    expect(snoozed).not.toContain("snooze_tomorrow");
  });

  it("offers nothing to skip on a call that has already happened", () => {
    const done = keys(callCardRowActions({ id: "c1", companyName: "Alpha", status: "called" }, owner));
    expect(done).not.toContain("skip_call");
    expect(done).not.toContain("start_call");
  });

  it("will not write to an address that has never been verified", () => {
    /*
     * Offering it opens a mail client addressed somewhere that failed or
     * never passed a check, which is how a bid loses a quote to a bounce
     * nobody saw.
     */
    const unverified = keys(
      subcontractorRowActions(
        { id: "s1", companyName: "Alpha", email: "a@b.com", emailVerified: false },
        owner
      )
    );
    expect(unverified).not.toContain("email_sub");
  });

  it("does not offer to stop outreach that is already stopped", () => {
    expect(
      keys(
        subcontractorRowActions(
          { id: "s1", companyName: "Alpha", outreachStopped: true },
          owner
        )
      )
    ).not.toContain("stop_outreach");
  });
});

describe("the actions that cannot be taken back", () => {
  it("sends aborting a bid to the control that takes a reason", () => {
    /*
     * The endpoint will not abort without a structured reason and the
     * record's own solicitation number typed back. A row that posted
     * `{ action: "abort" }` behind a yes/no dialog would have failed every
     * time, and the operator would have been told the abort could not be
     * recorded for a button the product plainly offered them.
     */
    const abort = opportunityRowActions({ id: "o1", stage: "outreach" }, owner).find(
      (a) => a.key === "abort_bid"
    );
    expect(abort?.run).toEqual({
      via: "widget",
      widget: { name: "abort_bid", opportunityId: "o1", title: "this opportunity" },
    });
    expect(abort?.danger).toBe(true);
    // And no undo, because there is not one. A toast offering it would be a
    // lie the next click discovers.
    expect(abort?.toast?.undo).toBeUndefined();
  });

  it("does not put a confirmation in front of anything a click can undo", () => {
    const reversible = opportunityRowActions({ id: "o1", stage: "analysis" }, owner).filter(
      (a) => a.key.startsWith("snooze") || a.key === "send_back"
    );
    expect(reversible.length).toBeGreaterThan(0);
    for (const a of reversible) expect(a.confirm).toBeUndefined();
  });

  it("sends passing through the control that asks for a reason", () => {
    const pass = opportunityRowActions({ id: "o1", stage: "scoring" }, owner).find(
      (a) => a.key === "pass"
    );
    // Not a POST from the row. A pass with no reason is the thing the record
    // page already refuses to do.
    expect(pass?.run.via).toBe("widget");
  });
});

describe("taking it back", () => {
  it("gives every snooze an undo that wakes the same record", () => {
    const snoozes = opportunityRowActions({ id: "o1", stage: "analysis" }, owner).filter((a) =>
      a.key.startsWith("snooze")
    );
    expect(snoozes.length).toBe(2);
    for (const a of snoozes) {
      expect(a.toast?.undo?.endpoint).toBe("/api/snooze");
      expect(a.toast?.undo?.body).toMatchObject({ kind: "opportunity", id: "o1", until: null });
    }
  });
});

describe("moving a record to a stage", () => {
  it("offers exactly the stages the move endpoint accepts", async () => {
    /*
     * The list used to be typed out here and had already lost scoring and the
     * call queue, so two moves the server allows could not be made from a
     * row. Naming them from the endpoint's own set is what stops the row's
     * idea of the pipeline drifting from the pipeline.
     */
    const { MOVE_TARGETS } = await import("@/lib/domain/row-actions");
    const { MANUAL_MOVE_TARGETS } = await import("@/lib/domain/stage-move");
    expect(MOVE_TARGETS.map((t) => t.stage)).toEqual([...MANUAL_MOVE_TARGETS]);
    for (const t of MOVE_TARGETS) expect(t.label.length).toBeGreaterThan(0);
  });

  it("counts the call queue as a stage, so a record in it can be sent back", async () => {
    // Left out of the order, the call queue read as position zero, which is
    // the one position with nothing behind it.
    const back = keys(opportunityRowActions({ id: "o1", stage: "call_queue" }, owner));
    expect(back).toContain("send_back");
  });
});

describe("the one button on the row", () => {
  it("is the decision when there is one to make", () => {
    const { primary, secondary } = splitRowActions(
      opportunityRowActions({ id: "o1", stage: "scoring" }, owner)
    );
    expect(primary?.key).toBe("pursue");
    expect(keys(secondary)).not.toContain("pursue");
  });

  it("is never two buttons", () => {
    for (const stage of ["scoring", "outreach", "bid_building", "quote_entry"]) {
      const actions = opportunityRowActions({ id: "o1", stage }, owner);
      expect(actions.filter((a) => a.primary).length).toBeLessThanOrEqual(1);
    }
  });

  it("leaves a row with no obvious next move showing only the menu", () => {
    const { primary, secondary } = splitRowActions(
      opportunityRowActions({ id: "o1", stage: "quote_entry" }, owner)
    );
    expect(primary).toBeNull();
    expect(secondary.length).toBeGreaterThan(0);
  });
});

describe("asking a subcontractor for something missing", () => {
  it("opens the composer rather than sending anything", () => {
    const ask = conversationRowActions(
      {
        threadKey: "t1",
        subcontractorId: "s1",
        subcontractorName: "Alpha Electric",
        openHref: "/communications?c=t1",
        outreachStopped: false,
      },
      owner
    ).find((a) => a.key === "request_info");
    expect(ask?.run).toEqual({
      via: "link",
      href: "/communications?c=t1&compose=request_info",
    });
  });

  it("writes the ends of the message and leaves the middle to a person", () => {
    const body = requestInfoMessage({
      companyName: "Alpha Electric",
      trade: "Electrical",
      opportunityTitle: "Fort Carson roofing",
    });
    expect(body).toContain("Hi Alpha Electric,");
    expect(body).toContain("Electrical on Fort Carson roofing");
    // No invented detail: naming the missing thing is the operator's job, and
    // deleting a paragraph of guesses is slower than typing one line.
    expect(body).not.toMatch(/insurance|W-9|certificate/i);
  });
});

describe("a row on the day's queue", () => {
  it("gets the call's own actions when the row is a call", () => {
    const actions = keys(
      workItemRowActions(
        {
          record: { kind: "call_card", id: "c1" },
          href: "/call-queue?open=c1",
          actionLabel: "Start the call",
          call: { companyName: "Alpha Electric", subcontractorId: "s1" },
        },
        owner
      )
    );
    expect(actions).toContain("start_call");
    expect(actions).toContain("skip_call");
    expect(actions).toContain("stop_outreach");
  });

  it("offers nothing but snoozing on a row whose work is reading something", () => {
    expect(
      keys(
        workItemRowActions(
          {
            record: { kind: "conversation", id: "m1" },
            href: "/communications?c=t1",
            actionLabel: "Read it",
            snooze: { kind: "opportunity", id: "o1" },
          },
          owner
        )
      )
    ).toEqual(["snooze_tomorrow", "snooze_3d"]);
  });
});
