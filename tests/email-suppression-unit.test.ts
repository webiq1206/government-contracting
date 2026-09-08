import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  query: queryMock,
  queryOne: queryOneMock,
}));

import {
  isSuppressed,
  suppressEmail,
  unsuppressEmail,
} from "../lib/domain/email-suppression";

describe("email suppression address handling", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryOneMock.mockReset();
  });

  it("checks the mailbox inside a display-name address", async () => {
    queryOneMock.mockResolvedValue({ id: "suppression-1" });

    await expect(isSuppressed("org-1", "Estimator <BIDS@Trade.Example>"))
      .resolves.toBe(true);
    expect(queryOneMock).toHaveBeenCalledWith(expect.stringContaining("org_id = $1"), [
      "org-1",
      "bids@trade.example",
    ]);
  });

  it("normalizes display-name addresses when adding and removing them", async () => {
    queryMock.mockResolvedValue([]);

    await suppressEmail({
      orgId: "org-1",
      email: "Estimator <BIDS@Trade.Example>",
      reason: "Asked us to stop",
      source: "reply",
    });
    await unsuppressEmail("org-1", "Estimator <BIDS@Trade.Example>");

    expect(queryMock.mock.calls[0]?.[1]).toEqual([
      "org-1",
      "bids@trade.example",
      "Asked us to stop",
      "reply",
    ]);
    expect(queryMock.mock.calls[1]?.[1]).toEqual(["org-1", "bids@trade.example"]);
  });

  it("fails closed when the suppression list cannot be read", async () => {
    queryOneMock.mockRejectedValue(new Error("database unavailable"));

    await expect(isSuppressed("org-1", "bids@trade.example")).rejects.toThrow(
      "database unavailable"
    );
  });
});
