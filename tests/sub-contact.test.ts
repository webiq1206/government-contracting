import { describe, it, expect } from "vitest";
import {
  contactStatusLabel,
  outreachBadgeClass,
  outreachLabel,
} from "@/lib/domain/sub-contact";

describe("sub-contact labels", () => {
  it("maps outreach states to plain English", () => {
    expect(outreachLabel("sent")).toBe("Email sent");
    expect(outreachLabel("responsive")).toBe("Responded");
    expect(outreachLabel("mystery_state")).toBe("mystery state");
  });

  it("maps contactability statuses", () => {
    expect(contactStatusLabel("verified")).toBe("Email verified");
    expect(contactStatusLabel(null)).toBeNull();
  });

  it("uses pursue styling for responsive outreach", () => {
    expect(outreachBadgeClass("responsive")).toContain("pursue");
    expect(outreachBadgeClass("send_failed")).toContain("risk");
  });
});
