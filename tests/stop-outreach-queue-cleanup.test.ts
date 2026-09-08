/**
 * A stop that half-worked has to say which half.
 *
 * Stopping outreach does two writes. The suppression is the decision and it
 * is the half that matters. Closing the subcontractor's pending call cards is
 * the tidy-up after it, and it can fail on its own.
 *
 * That second write used to end in `.catch(() => undefined)`, and the route
 * then answered `ok: true`. So on a failure the operator was told outreach
 * was stopped while the pending calls stayed in the queue, and the next
 * person to work the queue could ring a subcontractor who had just been told
 * nobody would. The stop held for email and quietly did not hold for the
 * phone, which is the kind of failure somebody finds out about from the
 * person they called.
 *
 * Two things are pinned here, and they pull in opposite directions:
 *
 *   the suppression is NOT rolled back when the tidy-up fails -- it is the
 *   half that succeeded and the subcontractor's decision stands;
 *
 *   and the failure is reported, with the count, rather than reading as a
 *   clean stop.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  requireOrgContext: vi.fn(),
  logAgent: vi.fn(async () => undefined),
  suppress: vi.fn(),
  stopImpact: vi.fn(),
  suppressionsFor: vi.fn(),
  lift: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock("@/lib/org-guard", () => ({
  requireOrgContext: mocks.requireOrgContext,
  notFoundResponse: () => new Response("not found", { status: 404 }),
}));
vi.mock("@/lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("@/lib/suppressions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/suppressions")>();
  return {
    ...actual,
    suppress: mocks.suppress,
    stopImpact: mocks.stopImpact,
    suppressionsFor: mocks.suppressionsFor,
    lift: mocks.lift,
  };
});

const IMPACT = {
  queuedEmails: 0,
  scheduledFollowUps: 0,
  pendingCalls: 3,
  openTasks: 0,
  clarificationRequests: 0,
  uncoveredTrades: [],
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/subcontractors/sub-1/stop-outreach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = { channel: "call", reason: "They asked us to stop." };

describe("stopping outreach when the call queue cannot be cleared", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrgContext.mockResolvedValue({
      orgId: "org-1",
      user: { email: "op@example.test" },
    });
    mocks.queryOne.mockResolvedValue({ id: "sub-1", company_name: "Rivera Mechanical" });
    mocks.stopImpact.mockResolvedValue(IMPACT);
    mocks.suppress.mockResolvedValue({ id: "sup-1" });
  });

  it("reports the pending calls it could not close, and keeps the stop", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Only the call-card cleanup fails.
    mocks.query.mockRejectedValueOnce(new Error("deadlock detected"));

    const { POST } = await import("../app/api/subcontractors/[id]/stop-outreach/route");
    const res = await POST(request(BODY), { params: { id: "sub-1" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    // The decision stands. Rolling it back would un-stop somebody who asked to
    // be left alone because a follow-up query failed.
    expect(mocks.suppress).toHaveBeenCalledTimes(1);
    expect(data.ok).toBe(true);
    expect(data.suppression).toBeTruthy();

    // And the half that failed is said out loud, with the count and the place
    // to finish it by hand.
    expect(data.warning, "a failed cleanup must not read as a clean stop").toBeTruthy();
    expect(data.warning).toContain("Rivera Mechanical");
    expect(data.warning).toContain("3 pending calls");
    expect(data.warning).toMatch(/call queue/i);

    // The real error reaches the server log, not the operator's screen.
    expect(errors.mock.calls.some((c) => String(c[0]).includes("sub-1"))).toBe(true);
    expect(data.warning).not.toContain("deadlock");
    errors.mockRestore();
  });

  it("says nothing extra when the cleanup succeeds", async () => {
    mocks.query.mockResolvedValue([]);

    const { POST } = await import("../app/api/subcontractors/[id]/stop-outreach/route");
    const res = await POST(request(BODY), { params: { id: "sub-1" } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.warning, "a clean stop must not raise a false alarm").toBeNull();
  });

  it("does not claim a stop at all when the suppression itself fails", async () => {
    mocks.suppress.mockRejectedValueOnce(new Error("constraint violation"));

    const { POST } = await import("../app/api/subcontractors/[id]/stop-outreach/route");

    /*
     * It throws rather than returning a response, which the framework turns
     * into a 500 and the client reads as "That could not be recorded." The
     * assertion that matters is the one this rules out: the half that matters
     * failing must never come back as an ok with a note attached, because a
     * warning next to the word "stopped" still reads as stopped.
     */
    await expect(
      POST(request(BODY), { params: { id: "sub-1" } })
    ).rejects.toThrow("constraint violation");
  });
});
