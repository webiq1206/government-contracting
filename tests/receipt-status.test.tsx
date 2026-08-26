import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptStatusCard } from "../components/receipt-status-card";
import { needsReceiptFollowUp } from "../lib/domain/submission-state";

/**
 * What the screen says about a send.
 *
 * "Sent" is the state that quietly loses bids: from inside this product a
 * rejected upload and a successful one look identical, and the difference
 * surfaces when the award goes to somebody else. So the card has to keep
 * saying that the agency has not acknowledged anything, and it has to
 * distinguish a confirmation number that was never issued from one nobody
 * recorded.
 */

const DAY = 24 * 60 * 60 * 1000;

function render(props: Parameters<typeof ReceiptStatusCard>[0]): string {
  return renderToStaticMarkup(<ReceiptStatusCard {...props} />);
}

const base = {
  state: "sent" as const,
  sentAt: new Date("2026-03-01T14:02:00Z"),
  method: "Government portal",
  destination: "SAM.gov",
  timezone: "America/Chicago",
  confirmationNumber: null,
  proofName: "Confirmation screen.png",
};

describe("what the card says about an unacknowledged send", () => {
  it("says the agency has not acknowledged it", () => {
    const html = render(base);
    expect(html).toContain("has not acknowledged");
    // The distinction that matters: a package was uploaded, which is not the
    // same as a buyer having received it.
    expect(html).toContain("not that the buyer received it");
  });

  it("reads an absent confirmation number as none issued, not as a blank", () => {
    const html = render(base);
    expect(html).toContain("None issued");
  });

  it("says plainly when no receipt is attached", () => {
    const html = render({ ...base, proofName: null });
    expect(html).toContain("Nothing attached");
  });

  it("escalates once a day has passed with no acknowledgement", () => {
    const html = render({ ...base, sentAt: new Date(Date.now() - 2 * DAY) });
    expect(html).toContain("still not acknowledged");
  });

  it("does not escalate in the first day", () => {
    const html = render({ ...base, sentAt: new Date(Date.now() - 60_000) });
    expect(html).toContain("awaiting acknowledgement");
    expect(html).not.toContain("still not acknowledged");
  });
});

describe("what the card says about the other states", () => {
  it("shows nothing at all before anything was sent", () => {
    expect(render({ ...base, state: "package_ready", sentAt: null })).toBe("");
    expect(render({ ...base, state: "approved", sentAt: null })).toBe("");
  });

  it("stops asking once the receipt is confirmed", () => {
    const html = render({ ...base, state: "receipt_confirmed" });
    expect(html).toContain("Receipt confirmed");
    expect(html).not.toContain("has not acknowledged");
  });

  it("says a rejection is a rejection", () => {
    const html = render({ ...base, state: "rejected" });
    expect(html).toContain("Rejected by the agency");
    // And does not go on asking for an acknowledgement that already came back.
    expect(html).not.toContain("has not acknowledged");
  });

  it("says a failed send failed", () => {
    expect(render({ ...base, state: "failed" })).toContain("The send failed");
  });
});

describe("the follow-up rule the card reads", () => {
  it("owes a follow-up only on a send that is a day old", () => {
    const now = new Date("2026-03-02T15:00:00Z");
    expect(needsReceiptFollowUp("sent", new Date("2026-03-01T14:00:00Z"), now)).toBe(true);
    expect(needsReceiptFollowUp("sent", new Date("2026-03-02T14:00:00Z"), now)).toBe(false);
    // Approved is not sent, so nothing is owed.
    expect(needsReceiptFollowUp("approved", new Date("2026-03-01T14:00:00Z"), now)).toBe(false);
    // And a send with no recorded time cannot be aged.
    expect(needsReceiptFollowUp("sent", null, now)).toBe(false);
  });
});
