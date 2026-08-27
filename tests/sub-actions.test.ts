import { describe, expect, it } from "vitest";
import {
  SUB_ACTIONS,
  nextRole,
  offersFor,
  roleLabel,
  type PairingFacts,
} from "../lib/domain/sub-actions";

const base: PairingFacts = {
  outreachState: "sent",
  role: null,
  removed: false,
  hasEmail: true,
  emailOnFile: true,
  hasPhone: true,
  emailsSent: 2,
  hasQuote: false,
  threadKey: "pair:o:s",
  hasThread: true,
  callsEnabled: true,
};

function reason(f: Partial<PairingFacts>, action: string): string | null {
  const offers = offersFor({ ...base, ...f });
  return offers.find((o) => o.action === action)?.unavailable ?? null;
}

describe("offersFor", () => {
  it("returns every action every time, so a row never quietly offers less", () => {
    const offers = offersFor(base);
    expect(offers.map((o) => o.action)).toEqual([...SUB_ACTIONS]);
  });

  it("offers everything on a healthy pairing", () => {
    expect(offersFor(base).filter((o) => o.unavailable)).toEqual([]);
  });

  it("separates an unverified address from a missing one", () => {
    // Two different problems with two different next steps. An operator sent
    // to fix an address that is already correct is an operator who stops
    // trusting the message.
    expect(reason({ hasEmail: false, emailOnFile: true }, "resend")).toMatch(/verification/i);
    expect(reason({ hasEmail: false, emailOnFile: false }, "resend")).toMatch(/No email/);
  });

  it("points at the phone when there is one and no address", () => {
    expect(reason({ hasEmail: false, emailOnFile: false, hasPhone: true }, "resend")).toMatch(
      /Call them/
    );
    expect(reason({ hasEmail: false, emailOnFile: false, hasPhone: false }, "resend")).toMatch(
      /no phone/i
    );
  });

  it("says calling is off for the account rather than blaming the firm", () => {
    expect(reason({ callsEnabled: false }, "call")).toMatch(/turned off for this account/);
    // And when calling is on, the reason is about this firm.
    expect(reason({ hasPhone: false }, "call")).toMatch(/No phone number on this firm/);
  });

  it("will not offer a packet nothing was sent in", () => {
    expect(reason({ emailsSent: 0 }, "view_packet")).toMatch(/Nothing has been sent/);
  });

  it("will not offer a thread with no messages behind it", () => {
    expect(reason({ hasThread: false }, "view_thread")).toMatch(/No messages/);
  });

  it("keeps the history readable on a firm taken off the bid", () => {
    const offers = offersFor({ ...base, removed: true });
    const by = new Map(offers.map((o) => [o.action, o.unavailable]));
    // Reading what happened must survive the removal. That record is the whole
    // reason a removal is a mark rather than a delete.
    expect(by.get("view_thread")).toBeNull();
    expect(by.get("view_packet")).toBeNull();
    // Sourcing a replacement is about the trade, not about this firm.
    expect(by.get("source_more")).toBeNull();
    // Everything that acts on the firm is refused, with the same reason.
    expect(by.get("resend")).toMatch(/off the bid/);
    expect(by.get("mark_primary")).toMatch(/off the bid/);
  });

  it("does not offer a rank a pairing already holds", () => {
    expect(reason({ role: "primary" }, "mark_primary")).toMatch(/Already the primary/);
    expect(reason({ role: "primary" }, "mark_backup")).toBeNull();
    expect(reason({ role: "backup" }, "mark_backup")).toMatch(/Already a backup/);
  });

  it("still offers quote entry when a quote already exists", () => {
    // A quote that came in wrong has to be correctable. Refusing the second
    // entry is how a typo becomes the number on a federal bid.
    expect(reason({ hasQuote: true }, "enter_quote")).toBeNull();
  });
});

describe("nextRole", () => {
  it("sets the rank that was asked for", () => {
    expect(nextRole(null, "primary")).toBe("primary");
    expect(nextRole("backup", "primary")).toBe("primary");
  });

  it("clears the rank when the same one is asked for again", () => {
    // A control that does nothing when pressed twice is one an operator
    // presses twice. Unranking is a real thing to want.
    expect(nextRole("primary", "primary")).toBeNull();
    expect(nextRole("backup", "backup")).toBeNull();
  });
});

describe("roleLabel", () => {
  it("names the absence rather than rendering blank", () => {
    // A trade where nobody has been picked reads identically to one where
    // somebody has, if the absence renders as nothing at all.
    expect(roleLabel(null)).toBe("Not ranked");
    expect(roleLabel("primary")).toBe("Primary");
    expect(roleLabel("backup")).toBe("Backup");
  });
});
