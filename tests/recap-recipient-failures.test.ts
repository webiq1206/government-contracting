import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mocks.query }));

import { platformRecapRecipients } from "@/lib/recap/recipients";

describe("platform recap recipient preference safety", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("fails closed when opt-out preferences cannot be read", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      platformRecapRecipients(["admin@example.test"])
    ).rejects.toThrow("database unavailable");
  });

  it("continues to exclude an allowlisted administrator who opted out", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        id: "user-1",
        email: "admin@example.test",
        name: "Admin",
        timezone: "America/Denver",
        recap_opt_out: true,
      },
    ]);

    await expect(
      platformRecapRecipients(["ADMIN@example.test"])
    ).resolves.toEqual([]);
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([["admin@example.test"]]);
  });
});
