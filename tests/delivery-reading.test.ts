import { describe, expect, it } from "vitest";
import { readDeliveryCode, statusFromDetail } from "@/lib/domain/email-delivery";

/**
 * The raw diagnostic a mail server returns is written for a postmaster.
 * "550 5.1.1 The email account that you tried to reach does not exist" and
 * "550 5.7.1 Message rejected due to content" both read as rejection to an
 * estimator, and they need opposite responses.
 */
describe("reading a delivery code", () => {
  it("tells a dead address from a refused message, which need opposite responses", () => {
    const dead = readDeliveryCode("5.1.1");
    expect(dead?.addressAtFault).toBe(true);
    expect(dead?.fix).toMatch(/working address/);

    const refused = readDeliveryCode("5.7.1");
    // The distinction that matters most: this address was fine all along, and
    // sending somebody hunting for a new contact is wasted work.
    expect(refused?.addressAtFault).toBe(false);
    expect(refused?.fix).toMatch(/address is fine/);
  });

  it("does not blame the address for a full mailbox", () => {
    const full = readDeliveryCode("5.2.2");
    expect(full?.addressAtFault).toBe(false);
    expect(full?.meaning).toMatch(/full/);
  });

  it("prefers the most specific code it knows", () => {
    // 5.1.1 must not fall through to the generic 5. reading.
    expect(readDeliveryCode("5.1.1")?.meaning).toMatch(/no mailbox/);
    expect(readDeliveryCode("4.2.2")?.meaning).toMatch(/keep trying/);
    expect(readDeliveryCode("4.7.28")?.meaning).toMatch(/temporary/);
  });

  it("still places an unlisted code in the right family", () => {
    const unknown5 = readDeliveryCode("5.9.42");
    expect(unknown5?.meaning).toMatch(/will not try again/);
    const unknown4 = readDeliveryCode("4.9.42");
    expect(unknown4?.meaning).toMatch(/temporary/);
    // A transient code never offers a fix that implies the firm is a lost
    // cause, because their server is going to try again.
    expect(unknown4?.addressAtFault).toBe(false);
  });

  it("returns nothing rather than guessing when there is no code", () => {
    expect(readDeliveryCode(null)).toBeNull();
    expect(readDeliveryCode("")).toBeNull();
    expect(readDeliveryCode("   ")).toBeNull();
    expect(readDeliveryCode("mailbox unavailable")).toBeNull();
  });
});

describe("finding the code in what the server said", () => {
  it("pulls the enhanced status out of a real diagnostic line", () => {
    expect(
      statusFromDetail("smtp; 550 5.1.1 The email account that you tried to reach does not exist")
    ).toBe("5.1.1");
    expect(statusFromDetail("Status: 4.2.2 mailbox full")).toBe("4.2.2");
  });

  it("returns nothing when the text carries no code", () => {
    expect(statusFromDetail(null)).toBeNull();
    expect(statusFromDetail("Delivery was temporarily deferred.")).toBeNull();
    // A version number is not a status code.
    expect(statusFromDetail("Postfix 3.6.4 could not deliver")).toBeNull();
  });
});
