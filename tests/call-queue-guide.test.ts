import { describe, it, expect } from "vitest";
import { buildCallQueueGuide } from "@/lib/domain/call-queue-guide";

describe("call queue guide", () => {
  it("names the top card and deep-links straight into it", () => {
    const plan = buildCallQueueGuide({
      first: { id: "cc1", companyName: "Rivera Mechanical", trade: "HVAC", fromReply: false },
      queueLength: 3,
    });
    expect(plan.total).toBe(3);
    expect(plan.active?.key).toBe("open");
    expect(plan.active?.plain).toBe(
      "Rivera Mechanical about HVAC is next by deadline. One tap opens the guided workspace."
    );
    expect(plan.active?.detail).toBe("3 calls waiting, this one first");
    expect(plan.active?.action).toEqual({
      label: "Start this call",
      href: "/call-queue?open=cc1",
    });
  });

  it("says the sub replied when the card came from a reply", () => {
    const plan = buildCallQueueGuide({
      first: { id: "cc2", companyName: "Apex Roofing", trade: null, fromReply: true },
      queueLength: 1,
    });
    expect(plan.active?.plain).toBe(
      "Apex Roofing replied to your email, so they are expecting to hear from you."
    );
    expect(plan.active?.detail).toBeUndefined();
    expect(plan.headline).toBe("Step 1 of 3: Open the top call");
  });
});
