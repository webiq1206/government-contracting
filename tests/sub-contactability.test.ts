import { describe, it, expect } from "vitest";
import {
  contactabilityBonus,
  hasContactPathway,
  isCallable,
  isEmailable,
} from "@/lib/domain/sub-contactability";
import { scoreCandidate } from "@/lib/agents/sub-finder";

describe("sub contactability", () => {
  it("requires at least one pathway", () => {
    expect(hasContactPathway({})).toBe(false);
    expect(hasContactPathway({ email: "a@b.com" })).toBe(true);
    expect(hasContactPathway({ phone: "208-555-0100" })).toBe(true);
    expect(hasContactPathway({ website: "https://example.com" })).toBe(true);
    expect(hasContactPathway({ email: "  ", phone: null })).toBe(false);
  });

  it("requires a phone to be callable and verified email to be emailable", () => {
    expect(isCallable({ phone: null })).toBe(false);
    expect(isCallable({ phone: "(208) 555-0100" })).toBe(true);
    expect(isEmailable({ email: "a@b.com", email_verified: false })).toBe(false);
    expect(isEmailable({ email: "a@b.com", email_verified: true })).toBe(true);
  });

  it("scores contactable Places candidates higher", () => {
    const bare = scoreCandidate({
      name: "Bare Co",
      place_id: "p1",
      rating: 4.5,
      review_count: 40,
    });
    const withPhone = scoreCandidate({
      name: "Phone Co",
      place_id: "p2",
      rating: 4.5,
      review_count: 40,
      phone: "208-555-0100",
      website: "https://phone.co",
    });
    expect(withPhone).toBeGreaterThan(bare);
    expect(contactabilityBonus({ phone: "1", website: "https://x.com" })).toBe(40);
  });
});
