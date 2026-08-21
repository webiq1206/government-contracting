/**
 * The matcher that decides which organizations the cleanup tool may delete.
 *
 * A false positive here erases a real customer's account, unrecoverably, so
 * the test bar is: it must catch every real leaked fixture, and it must NEVER
 * match a name a customer could plausibly type. When in doubt, it must say no.
 */
import { describe, it, expect } from "vitest";
import { looksLikeTestOrg } from "../lib/domain/test-org-match";

describe("looksLikeTestOrg — catches leaked fixtures", () => {
  it("matches the fixtures actually seen leaked in production", () => {
    for (const name of [
      "attack-A-51f226c0-33ad-4d28-9d31-a98b8a90c1ed",
      "attack-B-837f238f-aa1e-475d-aaff-6c940fd03ac5",
      "maint-a-9e6cf04d-6c09-4199-affd-6e4cd2df059f",
      "maint-b-c3511fca-4883-45f9-acba-951fc12939c5",
      "Applied Co b0c2b405",
      "Unstamped Co b0c2b405",
    ]) {
      expect(looksLikeTestOrg(name), name).toBe(true);
    }
  });

  it("matches the other suite prefixes when tagged", () => {
    for (const name of [
      "comp-a-1234abcd",
      "iso-b-deadbeef-1111-2222-3333-444455556666",
      "onebid-aabbccdd",
      "Race Co A 1a2b3c4d",
    ]) {
      expect(looksLikeTestOrg(name), name).toBe(true);
    }
  });
});

describe("looksLikeTestOrg — never touches a real org", () => {
  it("refuses names a customer could actually type", () => {
    for (const name of [
      "BROST CO",
      "Acme Roofing Co",
      "Applied Co",                 // the prefix, but NO generated tag
      "Bravo Builders Incorporated",
      "Firm Foundations LLC",
      "Attackers Security Services", // starts like "attack" but is a real word, no tag
      "Bounce House Rentals",        // starts like "bounce", real, no tag
      "Sub Zero Refrigeration",      // starts like "sub", real, no tag
      "Race City Motors",            // starts like "race", real, no tag
    ]) {
      expect(looksLikeTestOrg(name), name).toBe(false);
    }
  });

  it("refuses a matching prefix without a generated tag", () => {
    // The tag is the whole safety story: prefix alone is never enough.
    expect(looksLikeTestOrg("attack-team")).toBe(false);
    expect(looksLikeTestOrg("maint-a-crew")).toBe(false);
  });

  it("refuses a generated tag without a known prefix", () => {
    // A real org that happened to end in hex must still be safe.
    expect(looksLikeTestOrg("Northgate 1a2b3c4d")).toBe(false);
  });

  it("is safe on empty and nullish input", () => {
    expect(looksLikeTestOrg("")).toBe(false);
    expect(looksLikeTestOrg(null)).toBe(false);
    expect(looksLikeTestOrg(undefined)).toBe(false);
    expect(looksLikeTestOrg("   ")).toBe(false);
  });
});
