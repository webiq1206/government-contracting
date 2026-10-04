import { describe, expect, it } from "vitest";
import { withMailSignature, BROSTCO_MAIL_SIGNATURE } from "../lib/domain/mail-signature";
import { LEGACY_ORG_ID } from "../lib/tenant-context";
describe("application-rendered branded signature", () => {
  it("adds the selected BrostCo signature once", () => {
    const text = withMailSignature("Thank you.", LEGACY_ORG_ID, "BrostCo <hello@brostco.com>");
    expect(text).toBe(`Thank you.\n\n${BROSTCO_MAIL_SIGNATURE}`);
    expect(withMailSignature(text, LEGACY_ORG_ID, "hello@brostco.com")).toBe(text);
  });
  it("does not borrow a brand across tenants or invent a sender before selection", () => {
    expect(withMailSignature("Hello", "another-tenant", "hello@brostco.com")).toBe("Hello");
    expect(withMailSignature("Hello", LEGACY_ORG_ID, "hello@webiq.co")).toBe("Hello");
    expect(withMailSignature("Hello", LEGACY_ORG_ID, "")).toBe("Hello");
  });
});
