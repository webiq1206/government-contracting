import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchReplies = vi.fn();
const recentDeliveryTo = vi.fn();
const markBounced = vi.fn();
const saveCursor = vi.fn();

const message = {
  threadId: "thread-1",
  from: "MAILER-DAEMON@example.test",
  to: "platform@example.test",
  cc: "",
  date: "Sun, 6 Sep 2026 12:00:00 +0000",
  subject: "Delivery Status Notification (Failure)",
  contentType: "multipart/report; report-type=delivery-status",
  rfc822MessageId: "<dsn-1@example.test>",
  inReplyTo: null,
  references: [],
  snippet: "failed",
  messageId: "gmail-1",
  body:
    "Final-Recipient: rfc822; recipient@example.test\n" +
    "Action: failed\nStatus: 5.1.1\n" +
    "Original-Message-ID: <recap-1@example.test>\n" +
    "Diagnostic-Code: smtp; mailbox does not exist",
  attachments: [],
};

const delivery = {
  id: "delivery-1",
  orgId: "11111111-1111-4111-8111-111111111111",
  scope: "org",
  status: "sent",
};

async function loadSweep() {
  vi.resetModules();
  vi.doMock("@/lib/integrations/gmail", () => ({ gmail: { fetchReplies } }));
  vi.doMock("@/lib/recap/bounce-cursor", () => ({ loadBounceCursor: async () => ({ after_sec: 12345, scan_started_sec: 12400, page_token: null }), saveBounceCursor: saveCursor, restartBouncePage: vi.fn() }));
  vi.doMock("@/lib/recap/delivery", () => ({ recentDeliveryTo, markBounced }));
  return import("@/lib/recap/bounces");
}

beforeEach(() => {
  saveCursor.mockReset();
  fetchReplies.mockReset();
  recentDeliveryTo.mockReset();
  markBounced.mockReset();
  fetchReplies.mockResolvedValue({ replies: [message] });
  recentDeliveryTo.mockResolvedValue(delivery);
  markBounced.mockResolvedValue(true);
});

afterEach(() => {
  vi.doUnmock("@/lib/integrations/gmail");
  vi.doUnmock("@/lib/recap/delivery");
  vi.doUnmock("@/lib/recap/bounce-cursor");
  vi.resetModules();
});

describe("recap bounce reconciliation", () => {
  it("does not turn a delivery-history lookup failure into no match", async () => {
    recentDeliveryTo.mockRejectedValueOnce(new Error("delivery database offline"));
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(result).toMatchObject({ scanned: 1, matched: 0, unmatched: 0, failed: 1 });
    expect(result.error).toContain("lookup failed");
    expect(result.error).toContain("delivery database offline");
    expect(markBounced).not.toHaveBeenCalled();
  });

  it("does not count a rejected history write as a recorded bounce", async () => {
    markBounced.mockRejectedValueOnce(new Error("write refused"));
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(result).toMatchObject({ matched: 0, failed: 1 });
    expect(result.error).toContain("could not be saved");
  });

  it("does not count a zero-row update as a recorded bounce", async () => {
    markBounced.mockResolvedValueOnce(false);
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(result).toMatchObject({ matched: 0, failed: 1 });
    expect(result.error).toContain("changed before its bounce could be recorded");
  });

  it("counts a match only after the history write succeeds", async () => {
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(result).toEqual({
      scanned: 1,
      matched: 1,
      unmatched: 0,
      failed: 0,
      truncated: false,
      error: null,
    });
    expect(recentDeliveryTo).toHaveBeenCalledWith(
      "recipient@example.test",
      72,
      "<recap-1@example.test>"
    );
  });

  it("surfaces a permanent bounce that cannot safely be tied to one recap", async () => {
    recentDeliveryTo.mockResolvedValueOnce(null);
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(result).toMatchObject({ matched: 0, unmatched: 1, failed: 0, error: null });
    expect(markBounced).not.toHaveBeenCalled();
  });

  it("saves a truncated scan for the next run instead of making an immediate quota burst", async () => {
    fetchReplies
      .mockResolvedValueOnce({ replies: [message], truncated: true, nextPageToken: "page-2" })
      .mockResolvedValueOnce({ replies: [] });
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(fetchReplies).toHaveBeenCalledTimes(1);
    expect(saveCursor).toHaveBeenCalledWith(expect.objectContaining({ after_sec: 12345 }), "page-2");
    expect(result).toMatchObject({ scanned: 1, matched: 1, truncated: true, error: null });
  });

  it("recognises an already-recorded bounce during an overlapping scan", async () => {
    recentDeliveryTo.mockResolvedValueOnce({ ...delivery, status: "bounced" });
    const { sweepRecapBounces } = await loadSweep();

    const result = await sweepRecapBounces();

    expect(result).toMatchObject({ matched: 0, unmatched: 0, failed: 0, error: null });
    expect(markBounced).not.toHaveBeenCalled();
  });
});
