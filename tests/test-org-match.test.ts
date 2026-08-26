/**
 * The matcher that decides which organizations the cleanup tool may delete.
 *
 * A false positive here erases a real customer's account, unrecoverably, so
 * the test bar is: it must catch every real leaked fixture, and it must NEVER
 * match a name a customer could plausibly type. When in doubt, it must say no.
 */
import { describe, it, expect } from "vitest";
import {
  looksLikeTestOrg,
  hasGeneratedTag,
  looksLikeTestEmail,
} from "../lib/domain/test-org-match";

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

describe("names seen leaked into the production database", () => {
  // These are real names read out of the live organizations table. Every one of
  // them must match, because each unmatched name is a fixture the cleanup
  // silently leaves behind while the per-org agents keep looping over it.
  const seenInProduction = [
    "Doomed Org ac0633c8",
    "Doomed Org 01d3a189",
    "Reyes Builders 6a58b19c",
    "Race Co A 6a58b19c",
    "Race Co B ddf7d82e",
    "Comped Co ebbd7e34",
    "Typo Co 66205f2e",
    "Existing Co 1256b147",
    "Race Revoke Co 0b37975c",
    "Applied Co e908c325",
    "Bound Co ebaa598d",
    "Unstamped Co 5d89b194",
  ];
  it.each(seenInProduction)("matches %s", (name) => {
    expect(looksLikeTestOrg(name)).toBe(true);
  });

  it("still refuses the same names without their tag", () => {
    // "Doomed Org" reached production unmatched, and widening the list is only
    // safe because the tag is still required.
    expect(looksLikeTestOrg("Doomed Org")).toBe(false);
    expect(looksLikeTestOrg("Award Contracting")).toBe(false);
    expect(looksLikeTestOrg("Bill's Excavating")).toBe(false);
    expect(looksLikeTestOrg("Submittal Partners LLC")).toBe(false);
  });
});

describe("hasGeneratedTag", () => {
  it("sees a tag whatever the name starts with, so near misses can be reported", () => {
    // The signal that would have caught "Doomed Org" before it was audited as
    // a customer -- reported to a human, never acted on by itself.
    expect(hasGeneratedTag("Weird Vendor Co 9f8e7d6c")).toBe(true);
    expect(hasGeneratedTag("Doomed Org ac0633c8")).toBe(true);
    expect(hasGeneratedTag("attack-51f226c0-33ad-4d28-9d31-a98b8a90c1ed")).toBe(true);
  });

  it("does not fire on ordinary company names", () => {
    expect(hasGeneratedTag("Northgate Construction")).toBe(false);
    expect(hasGeneratedTag("BROST CO")).toBe(false);
    expect(hasGeneratedTag("")).toBe(false);
    expect(hasGeneratedTag(null)).toBe(false);
  });

  it("is not on its own enough to delete anything", () => {
    // The two-signal rule is what stands between cleanup and losing a customer.
    expect(hasGeneratedTag("Northgate 1a2b3c4d")).toBe(true);
    expect(looksLikeTestOrg("Northgate 1a2b3c4d")).toBe(false);
  });
});

describe("looksLikeTestEmail", () => {
  it("recognises the domains RFC 2606 reserves, which nobody can register", () => {
    expect(looksLikeTestEmail("invite-admin-2abd94e6@example.test")).toBe(true);
    expect(looksLikeTestEmail("someone@test")).toBe(true);
    expect(looksLikeTestEmail("a@sub.example.com")).toBe(true);
    expect(looksLikeTestEmail("a@example.org")).toBe(true);
    expect(looksLikeTestEmail("a@example.net")).toBe(true);
  });

  it("leaves a real address alone", () => {
    expect(looksLikeTestEmail("owner@brostco.com")).toBe(false);
    expect(looksLikeTestEmail("info@webiq.co")).toBe(false);
    // The trap: a real domain that merely contains the word.
    expect(looksLikeTestEmail("owner@testequipment.com")).toBe(false);
    expect(looksLikeTestEmail("owner@example.company")).toBe(false);
  });

  it("does not fall over on junk", () => {
    expect(looksLikeTestEmail(null)).toBe(false);
    expect(looksLikeTestEmail("")).toBe(false);
    expect(looksLikeTestEmail("not-an-address")).toBe(false);
    expect(looksLikeTestEmail("trailing@")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(looksLikeTestEmail("  Admin@Example.TEST  ")).toBe(true);
  });
});
