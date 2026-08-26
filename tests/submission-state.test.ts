import { describe, expect, it } from "vitest";
import {
  canSubmit,
  describeGaps,
  maySend,
  needsReceiptFollowUp,
  parseSubmissionState,
  primaryActionLabel,
  proofSummary,
  sentEvidenceGaps,
  SUBMISSION_STATES,
  type SentEvidence,
} from "../lib/domain/submission-state";

/**
 * For almost every solicitation this product handles, Brost Co does not submit
 * anything. A person opens a government portal, uploads the files themselves,
 * and comes back.
 *
 * The button said "Submit bid package". The endpoint ran
 * `update bids set submitted_at=now()`. Nothing recorded how the package
 * reached the agency, when, to what address, or whether anybody acknowledged
 * it. A bid recorded as submitted with no evidence is worse than one recorded
 * as ready, because the first stops anybody checking.
 */

const evidence = (over: Partial<SentEvidence> = {}): SentEvidence => ({
  method: "portal",
  destination: "SAM.gov",
  sentAt: new Date("2026-08-26T19:02:00Z"),
  timezone: "America/Chicago",
  confirmationNumber: "4471-A",
  proofDocumentId: "doc-1",
  attestation: "Uploaded all six files and saw the success screen.",
  packageHash: "abc123",
  ...over,
});

describe("what the button is allowed to say", () => {
  it("says Mark as sent when a person does the sending", () => {
    // A button that says Submit, on a screen that cannot submit, tells an
    // operator the product did something it did not do.
    for (const method of ["portal", "email", "mail", "hand"] as const) {
      expect(primaryActionLabel(method), method).toBe("Mark as sent");
    }
  });

  it("says Submit bid package only when a connector actually sends", () => {
    expect(primaryActionLabel("connector")).toBe("Submit bid package");
  });

  it("says Mark as sent when the method is not yet known", () => {
    expect(primaryActionLabel(null)).toBe("Mark as sent");
  });
});

describe("what must be recorded before this is called sent", () => {
  it("accepts a complete manual send", () => {
    expect(sentEvidenceGaps(evidence())).toEqual([]);
    expect(maySend(evidence())).toBe(true);
  });

  it.each([
    [{ method: null }, "method"],
    [{ destination: "  " }, "destination"],
    [{ sentAt: null }, "sent_at"],
    [{ timezone: null }, "timezone"],
    [{ proofDocumentId: null }, "proof"],
    [{ attestation: "" }, "attestation"],
    [{ packageHash: null }, "package_hash"],
  ])("refuses when %j is missing", (missing, gap) => {
    expect(sentEvidenceGaps(evidence(missing))).toContain(gap);
    expect(maySend(evidence(missing))).toBe(false);
  });

  it("does not require a confirmation number", () => {
    /*
     * Plenty of portals do not issue one, and demanding it pushes operators
     * into typing something untrue into a field that exists to be evidence.
     * The receipt is required instead, because every portal produces a screen
     * that can be captured.
     */
    expect(sentEvidenceGaps(evidence({ confirmationNumber: null }))).toEqual([]);
  });

  it("does not ask a connector send for a screenshot", () => {
    // The request, the response and the provider's identifier are the
    // evidence. Asking a person to photograph a screen for something they did
    // not do by hand is ceremony.
    const connector = evidence({ method: "connector", proofDocumentId: null, attestation: null });
    expect(sentEvidenceGaps(connector)).toEqual([]);
  });

  it("names what is still needed in a sentence", () => {
    const gaps = sentEvidenceGaps(evidence({ proofDocumentId: null, attestation: null }));
    expect(describeGaps(gaps)).toBe(
      "Still needed: a receipt, screenshot or confirmation email and your confirmation of what you did."
    );
    expect(describeGaps([])).toBe("Everything needed is recorded.");
  });
});

describe("the states a bid can move between", () => {
  it("cannot reach sent without passing approval first", () => {
    expect(canSubmit("package_ready", "sent")).toBe(false);
    expect(canSubmit("approved", "sent")).toBe(true);
  });

  it("lets an external upload skip the sending phase", () => {
    // There is no observable "sending" when the operator does it in another
    // application and comes back.
    expect(canSubmit("approved", "sent")).toBe(true);
  });

  it("never treats sent as accepted", () => {
    /*
     * The difference between "we sent it" and "they have it" is the
     * difference between a bid that counts and one that does not.
     */
    expect(canSubmit("sent", "accepted")).toBe(true);
    expect(canSubmit("package_ready", "accepted")).toBe(false);
    expect(canSubmit("approved", "accepted")).toBe(false);
  });

  it("lets a rejection be corrected and sent again", () => {
    expect(canSubmit("rejected", "package_ready")).toBe(true);
    // And a corrected package has to be approved again rather than going
    // straight back out.
    expect(canSubmit("rejected", "sent")).toBe(false);
  });

  it("treats accepted as final", () => {
    for (const to of SUBMISSION_STATES) {
      expect(canSubmit("accepted", to), to).toBe(false);
    }
  });

  it("reads an unrecognised state as nothing having been sent", () => {
    // Reading a typo as `sent` would claim delivery on the strength of it.
    for (const bad of [null, undefined, "", "submitted", 3]) {
      expect(parseSubmissionState(bad)).toBe("package_ready");
    }
    expect(parseSubmissionState("RECEIPT_CONFIRMED")).toBe("receipt_confirmed");
  });
});

describe("chasing a receipt", () => {
  it("asks for a follow-up when a send was never acknowledged", () => {
    // Sent and never acknowledged is the state that quietly loses bids.
    const sentAt = new Date("2026-08-25T12:00:00Z");
    const now = new Date("2026-08-26T13:00:00Z");
    expect(needsReceiptFollowUp("sent", sentAt, now)).toBe(true);
  });

  it("does not nag on the same day", () => {
    const sentAt = new Date("2026-08-26T12:00:00Z");
    const now = new Date("2026-08-26T14:00:00Z");
    expect(needsReceiptFollowUp("sent", sentAt, now)).toBe(false);
  });

  it("stops once the agency has acknowledged it", () => {
    const sentAt = new Date("2026-08-20T12:00:00Z");
    const now = new Date("2026-08-26T12:00:00Z");
    for (const state of ["receipt_confirmed", "accepted", "rejected"] as const) {
      expect(needsReceiptFollowUp(state, sentAt, now), state).toBe(false);
    }
  });
});

describe("what the audit line says", () => {
  it("describes what is proven, not what the state is called", () => {
    /*
     * "Sent" is a word. "Uploaded to a government portal at ... confirmation
     * 4471-A, receipt attached" is a thing somebody can stand behind.
     */
    const line = proofSummary("sent", evidence());
    expect(line).toContain("Uploaded to a government portal");
    expect(line).toContain("SAM.gov");
    expect(line).toContain("America/Chicago");
    expect(line).toContain("confirmation 4471-A");
    expect(line).toContain("receipt attached");
    expect(line).toContain("the agency has not acknowledged it");
  });

  it("says plainly when there is no confirmation and no receipt", () => {
    const line = proofSummary("sent", evidence({ confirmationNumber: null, proofDocumentId: null }));
    expect(line).toContain("no confirmation number was issued");
    expect(line).toContain("no receipt attached");
  });

  it("refuses to dress up a package nobody sent", () => {
    for (const state of ["package_ready", "approved"] as const) {
      expect(proofSummary(state, evidence())).toBe(
        "Nothing has been sent. No evidence of delivery exists."
      );
    }
  });

  it("says so when a send time was never saved", () => {
    expect(proofSummary("sent", evidence({ sentAt: null }))).toContain("no send time was saved");
  });
});
