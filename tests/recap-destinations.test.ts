import { describe, expect, it } from "vitest";
import { buildRecap } from "@/lib/domain/recap/sections";
import {
  callDestination,
  draftDestination,
  replyDestination,
  reviewDestination,
  workbenchHref,
} from "@/lib/domain/recap/destinations";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";
import { emptyFacts } from "./helpers/recap-facts";

/**
 * A recap row is worth a click only if the click finishes something.
 *
 * These pin the two halves of that: the mapping from a recap fact to the
 * workbench item that completes it, and the refusal to invent one where the
 * workbench would have nothing to show.
 */

const NOW = new Date("2026-08-30T13:00:00Z");
const OPP = "3f7c9a10-0000-4000-8000-000000000001";
const SUB = "3f7c9a10-0000-4000-8000-000000000002";
const CARD = "3f7c9a10-0000-4000-8000-000000000003";
const REPLY = "3f7c9a10-0000-4000-8000-000000000004";

function ctx() {
  return {
    scope: "org" as const,
    localDate: "2026-08-29",
    timezone: "America/Denver",
    dayLabel: "Saturday, August 29",
    now: NOW,
    ages: {},
    partial: false,
  };
}

describe("where a recap row sends you", () => {
  it("sends a borderline decision to the workbench item that decides it", () => {
    expect(reviewDestination(OPP)).toBe(`/workbench?i=decide%3A${OPP}`);
  });

  it("sends a prepared call to the workbench item that makes it", () => {
    expect(callDestination(CARD)).toBe(`/workbench?i=call%3A${CARD}`);
  });

  it("escapes the key, so a colon cannot be read as part of the path", () => {
    expect(workbenchHref("reply:abc")).toBe("/workbench?i=reply%3Aabc");
  });

  /*
   * The one mapping that is not one-to-one. The recap counts every reply
   * nobody has answered in three weeks; the workbench only holds the ones the
   * automatic reader flagged. Sending the rest to a queue that does not list
   * them would land the reader on an unrelated piece of work.
   */
  it("sends a flagged, unread reply to the workbench", () => {
    expect(
      replyDestination({
        id: REPLY,
        needsReview: true,
        reviewedAt: null,
        subcontractorId: SUB,
      })
    ).toBe(`/workbench?i=reply%3A${REPLY}`);
  });

  it("sends an unflagged reply to the subcontractor's own file instead", () => {
    expect(
      replyDestination({
        id: REPLY,
        needsReview: false,
        reviewedAt: null,
        subcontractorId: SUB,
      })
    ).toBe(`/subs/${SUB}`);
  });

  it("sends an already-read reply to the file too, flagged or not", () => {
    expect(
      replyDestination({
        id: REPLY,
        needsReview: true,
        reviewedAt: "2026-08-29T10:00:00Z",
        subcontractorId: SUB,
      })
    ).toBe(`/subs/${SUB}`);
  });

  it("falls back to the inbox when the reply has no sender on it", () => {
    expect(
      replyDestination({ id: REPLY, needsReview: true, reviewedAt: null, subcontractorId: null })
    ).toBe("/workbench?i=reply%3A" + REPLY);
    expect(
      replyDestination({ id: REPLY, needsReview: false, reviewedAt: null, subcontractorId: null })
    ).toBe("/communications");
  });

  it("leaves a drafted reply on the record: the workbench has no item for one", () => {
    expect(draftDestination(SUB)).toBe(`/subs/${SUB}`);
    expect(draftDestination(null)).toBe("/communications");
  });
});

describe("the rows a built recap actually renders", () => {
  const facts = emptyFacts({
    reviewQueue: [
      { id: OPP, title: "Roof replacement", score: 61, tier: "review", expiresAt: null },
    ],
    callQueue: [
      {
        id: CARD,
        opportunityId: OPP,
        opportunity: "Roof replacement",
        subcontractorId: SUB,
        subcontractor: "Rivera Mechanical",
        createdAt: "2026-08-28T15:00:00Z",
      },
    ],
    unansweredReplies: [
      {
        id: REPLY,
        subcontractorId: SUB,
        subcontractor: "Rivera Mechanical",
        opportunityId: OPP,
        opportunity: "Roof replacement",
        intent: "question",
        needsReview: true,
        reviewedAt: null,
        createdAt: "2026-08-27T15:00:00Z",
      },
    ],
  });

  const recap = buildRecap(facts, DEFAULT_RECAP_SETTINGS, ctx());
  const rows = recap.sections.flatMap((s) => s.items);
  const row = (key: string) => rows.find((i) => i.key === key);

  it("points the decision, the call and the flagged reply into the workbench", () => {
    expect(row(`review:${OPP}`)?.href).toBe(`/workbench?i=decide%3A${OPP}`);
    expect(row(`call:${CARD}`)?.href).toBe(`/workbench?i=call%3A${CARD}`);
    expect(row(`reply:${REPLY}`)?.href).toBe(`/workbench?i=reply%3A${REPLY}`);
  });

  /*
   * The workbench link is a queue address, not a record. The preview pane
   * reads the record from here instead, so pointing a row at the work does
   * not cost it its quick look.
   */
  it("still carries the record behind each of those rows", () => {
    expect(row(`review:${OPP}`)?.recordHref).toBe(`/opportunity/${OPP}`);
    expect(row(`call:${CARD}`)?.recordHref).toBe(`/subs/${SUB}`);
    expect(row(`reply:${REPLY}`)?.recordHref).toBe(`/subs/${SUB}`);
  });

  it("leaves the rows that are not tasks pointing at their record", () => {
    const deadlineRows = rows.filter((i) => i.key.startsWith("deadline:"));
    for (const r of deadlineRows) expect(r.href?.startsWith("/workbench")).toBe(false);
  });
});
