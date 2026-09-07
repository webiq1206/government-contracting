import { describe, expect, it } from "vitest";
import {
  unambiguousRecentDelivery,
  type RecapDelivery,
} from "../lib/recap/delivery";

function delivery(id: string, orgId: string | null, scope: "org" | "platform"): RecapDelivery {
  return {
    id,
    orgId,
    scope,
    userId: null,
    recipientEmail: "shared@example.com",
    localDate: "2026-09-07",
    timezone: "UTC",
    status: "sent",
    late: false,
    quiet: false,
    test: false,
    dueAt: null,
    sentAt: "2026-09-07T08:00:00.000Z",
    providerAttemptedAt: null,
    attempts: 1,
    urgentCount: 0,
    subject: "Recap",
    html: null,
    textBody: null,
    providerMessageId: null,
    error: null,
    createdAt: "2026-09-07T08:00:00.000Z",
    updatedAt: "2026-09-07T08:00:00.000Z",
  };
}

describe("recap bounce matching without a usable Message-ID", () => {
  it("uses the newest delivery when every candidate belongs to one account", () => {
    const newest = delivery("new", "org-a", "org");
    expect(unambiguousRecentDelivery([newest, delivery("old", "org-a", "org")])).toBe(newest);
  });

  it("refuses to guess between two organizations", () => {
    expect(
      unambiguousRecentDelivery([
        delivery("a", "org-a", "org"),
        delivery("b", "org-b", "org"),
      ])
    ).toBeNull();
  });

  it("refuses to guess between an account recap and a platform recap", () => {
    expect(
      unambiguousRecentDelivery([
        delivery("account", "org-a", "org"),
        delivery("platform", null, "platform"),
      ])
    ).toBeNull();
  });
});
