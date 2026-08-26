/**
 * The promise the word "viewer" makes.
 *
 * `organization_members.role` has held owner / admin / operator / viewer since
 * multi-tenancy shipped. The admin panel displayed it. Two queries sorted by
 * it. Nothing else read it at all, so every signed-in member of an
 * organization had identical write access: the account labelled "read-only"
 * could change final pricing, publish account-wide automation rules, delete
 * subcontractors and submit a federal bid.
 *
 * These tests are mostly about denial, because denial is the part that was
 * missing. The single most important one is the last: that an unrecognised
 * role fails closed.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITIES,
  can,
  capabilitiesOf,
  capabilityLabel,
  normalizeRole,
  roleLabel,
  rolesWith,
  permissionMessage,
} from "@/lib/domain/roles";

describe("can", () => {
  it("lets an owner do everything", () => {
    for (const cap of capabilitiesOf("owner")) expect(can("owner", cap)).toBe(true);
    expect(can("owner", "manage_billing")).toBe(true);
    expect(can("owner", "delete_records")).toBe(true);
  });

  it("stops an admin at billing and nothing else", () => {
    /*
     * An administrator runs the account; the owner pays for it. Those are
     * different people often enough that collapsing them would either hand the
     * card to the wrong person or stop the right one from working.
     */
    expect(can("admin", "manage_billing")).toBe(false);
    expect(can("admin", "manage_rules")).toBe(true);
    expect(can("admin", "delete_records")).toBe(true);
    expect(can("admin", "submit")).toBe(true);
  });

  it("lets a bid manager run bids but not change account settings", () => {
    for (const cap of ["decide", "outreach", "price", "submit", "manage_subs"] as const) {
      expect(can("operator", cap)).toBe(true);
    }
    // The line where damage stops being one bid and starts being the account.
    for (const cap of ["manage_rules", "manage_integrations", "manage_profile",
                       "manage_team", "manage_billing", "delete_records"] as const) {
      expect(can("operator", cap)).toBe(false);
    }
  });

  it("treats estimator and operator as the same job", () => {
    expect(capabilitiesOf("estimator")).toEqual(capabilitiesOf("operator"));
  });

  it("stops a team member short of money and commitment", () => {
    expect(can("member", "outreach")).toBe(true);
    expect(can("member", "manage_subs")).toBe(true);
    // The two actions that commit money and commit the company.
    expect(can("member", "price")).toBe(false);
    expect(can("member", "submit")).toBe(false);
  });

  it("lets a viewer read and nothing else", () => {
    expect(capabilitiesOf("viewer")).toEqual(["view"]);
    for (const cap of ["decide", "outreach", "price", "submit", "manage_subs",
                       "manage_rules", "delete_records", "pause_automation"] as const) {
      expect(can("viewer", cap)).toBe(false);
    }
  });

  it("gives every role the ability to read", () => {
    for (const role of ["owner", "admin", "operator", "estimator", "member", "viewer"]) {
      expect(can(role, "view")).toBe(true);
    }
  });
});

describe("normalizeRole", () => {
  it("fails closed on anything it does not recognise", () => {
    /*
     * A typo in a seed, a role added to the database before the code knows
     * about it, a hand-edited row. Being wrong this way costs somebody asking
     * to be let in. Being wrong the other way costs a stranger submitting a
     * bid.
     */
    expect(normalizeRole("superuser")).toBe("viewer");
    expect(normalizeRole("")).toBe("viewer");
    expect(normalizeRole(null)).toBe("viewer");
    expect(normalizeRole(undefined)).toBe("viewer");
    expect(can("Owner ", "manage_billing")).toBe(true); // trimmed and lowercased
    expect(can("owner; drop table users", "manage_billing")).toBe(false);
  });
});

describe("permission messages", () => {
  it("names who can do it instead of only saying no", () => {
    // "Access denied" with no route forward reads as a broken product.
    const msg = permissionMessage("viewer", "submit");
    expect(msg).toContain("read-only");
    expect(msg).toContain("submit bids");
    expect(msg).toMatch(/Account owner|Administrator|Bid manager/);
  });

  it("does not list the duplicate role name twice", () => {
    // estimator and operator are one row wearing two names; naming both reads
    // as two different answers.
    const who = rolesWith("submit");
    expect(who.match(/bid manager/gi) ?? []).toHaveLength(1);
    expect(who.toLowerCase()).not.toContain("estimator");
  });

  it("uses the label people recognise, not the stored value", () => {
    expect(roleLabel("operator")).toBe("Bid manager");
    expect(roleLabel("viewer")).toBe("Read-only");
    expect(roleLabel(null)).toBe("Read-only");
  });
});

describe("the full capability list", () => {
  it("names every capability exactly once", () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
    // The owner holds every capability, so its row is the complete set.
    expect([...ALL_CAPABILITIES].sort()).toEqual([...capabilitiesOf("owner")].sort());
  });

  it("labels every one of them", () => {
    for (const c of ALL_CAPABILITIES) expect(capabilityLabel(c).length).toBeGreaterThan(0);
  });
});
