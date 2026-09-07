import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock("@/lib/db", () => db);

import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";
import { getRecapSettings, recapConfigured } from "@/lib/recap/settings";

describe("recap settings read truth", () => {
  beforeEach(() => {
    db.query.mockReset();
    db.queryOne.mockReset();
  });

  it("uses documented defaults only when the settings row is legitimately absent", async () => {
    db.queryOne.mockResolvedValueOnce(null);

    await expect(getRecapSettings("11111111-1111-4111-8111-111111111111")).resolves.toEqual(
      DEFAULT_RECAP_SETTINGS
    );
  });

  it("propagates a failed settings read instead of pretending defaults were saved", async () => {
    db.queryOne.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      getRecapSettings("11111111-1111-4111-8111-111111111111")
    ).rejects.toThrow("database unavailable");
  });

  it("does not call an unreadable configuration record unconfigured", async () => {
    db.queryOne.mockRejectedValueOnce(new Error("read refused"));

    await expect(
      recapConfigured("11111111-1111-4111-8111-111111111111")
    ).rejects.toThrow("read refused");
  });
});
