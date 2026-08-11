/**
 * Handler-level tests for the Resend inbound webhook against realistic
 * `email.received` payloads (metadata-only, body fetched via the receiving
 * API), including signature rejection and the fetch-failure fail-loud path.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";

const rawSecret = Buffer.from("handler-test-secret-32-bytes!!!!").toString("base64");
const secret = `whsec_${rawSecret}`;

const getReceived = vi.fn();
const enqueueMock = vi.fn(async () => null);
const captureReplyMock = vi.fn();
const matchInboundReplyMock = vi.fn();
vi.mock("../lib/integrations/resend", () => ({
  email: {
    enabled: () => true,
    getReceived: (...args: unknown[]) => getReceived(...args),
    send: vi.fn(async () => ({ id: "x" })),
    sendDigest: vi.fn(async () => ({ id: "x" })),
  },
}));
vi.mock("../lib/logger", () => ({ logAgent: vi.fn(async () => undefined) }));
vi.mock("../lib/queue", () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...(args as [])),
}));
vi.mock("../lib/reply-capture", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/reply-capture")>();
  return {
    ...real,
    matchInboundReply: (...args: unknown[]) =>
      matchInboundReplyMock.mock.calls.length >= 0 && matchInboundReplyMock.getMockImplementation()
        ? matchInboundReplyMock(...(args as []))
        : real.matchInboundReply(...(args as [Parameters<typeof real.matchInboundReply>[0]])),
    captureReply: (...args: unknown[]) =>
      captureReplyMock.getMockImplementation()
        ? captureReplyMock(...(args as []))
        : real.captureReply(...(args as [Parameters<typeof real.captureReply>[0]])),
  };
});

function signedRequest(body: unknown): Request {
  const payload = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig =
    "v1," +
    createHmac("sha256", Buffer.from(rawSecret, "base64"))
      .update(`msg_1.${ts}.${payload}`)
      .digest("base64");
  return new Request("http://localhost/api/webhooks/resend-inbound", {
    method: "POST",
    headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig },
    body: payload,
  });
}

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("resend inbound webhook handler", () => {
  let POST: (req: Request) => Promise<Response>;
  const prevSecret = process.env.RESEND_WEBHOOK_SECRET;

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    ({ POST } = await import("../app/api/webhooks/resend-inbound/route"));
  });
  afterAll(() => {
    if (prevSecret == null) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = prevSecret;
  });

  it("rejects an unsigned request", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(401);
  });

  it("fetches the body via the receiving API for a metadata-only email.received payload", async () => {
    getReceived.mockResolvedValueOnce({
      text: "We quote $55,000 for the work.",
      from: "unknown-sender-xyz@nowhere-matching.test",
      to: ["info@brostco.com"],
    });
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: {
          email_id: "rcv_123",
          from: "unknown-sender-xyz@nowhere-matching.test",
          to: ["info@brostco.com"],
          subject: "Re: outreach",
        },
      })
    );
    expect(getReceived).toHaveBeenCalledWith("rcv_123");
    expect(res.status).toBe(200);
    const json = await res.json();
    // Unknown sender + no correlation token: no outbound comm matches.
    expect(json).toMatchObject({ ok: true, matched: false });
  });

  it("fails loudly (502) when the received email content cannot be fetched", async () => {
    getReceived.mockResolvedValueOnce({ error: "not found" });
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: { email_id: "rcv_456", from: "a@b.test", to: ["info@brostco.com"] },
      })
    );
    expect(res.status).toBe(502);
  });

  it("re-attempts the enqueue on duplicate delivery and reports duplicate", async () => {
    matchInboundReplyMock.mockImplementation(async () => ({
      comm: {
        id: "c1",
        subcontractor_id: "s1",
        opportunity_id: "o1",
        company_name: "Sub",
        sub_email: "sub@x.test",
        opportunity_title: "Job",
      },
      strongMatch: true,
    }));
    captureReplyMock.mockImplementation(async () => ({
      subId: "s1",
      companyName: "Sub",
      extracted: {
        intent: "other",
        isQuote: false,
        quoteAmount: null,
        paymentTerms: null,
        notes: null,
        companyName: null,
        canPerform: null,
        capabilityNotes: null,
        tradesMentioned: [],
        method: "regex",
      },
      quoteSaved: false,
      quoteSkippedExisting: false,
      senderVerified: false,
      trade: null,
      duplicate: true,
      declined: false,
      thankYouSent: false,
    }));
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: { email_id: "rcv_dup", from: "sub@x.test", to: ["info+tabc123ab@brostco.com"], text: "hello $1,000" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: true, duplicate: true });
    expect(enqueueMock).toHaveBeenCalled(); // retry heals a previously failed enqueue
    matchInboundReplyMock.mockReset();
    captureReplyMock.mockReset();
  });

  it("skips call-prep enqueue when capture marks the reply as declined", async () => {
    matchInboundReplyMock.mockImplementation(async () => ({
      comm: {
        id: "c1",
        subcontractor_id: "s1",
        opportunity_id: "o1",
        company_name: "Sub",
        sub_email: "sub@x.test",
        opportunity_title: "Job",
      },
      strongMatch: true,
    }));
    captureReplyMock.mockImplementation(async () => ({
      subId: "s1",
      companyName: "Sub",
      extracted: {
        intent: "cant_fulfill",
        isQuote: false,
        quoteAmount: null,
        paymentTerms: null,
        notes: null,
        companyName: null,
        canPerform: false,
        capabilityNotes: "Wrong trade",
        tradesMentioned: [],
        method: "ai",
      },
      quoteSaved: false,
      quoteSkippedExisting: false,
      senderVerified: true,
      trade: "electrical",
      duplicate: false,
      declined: true,
      thankYouSent: true,
    }));
    enqueueMock.mockClear();
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: {
          email_id: "rcv_decline",
          from: "sub@x.test",
          to: ["info@brostco.com"],
          text: "We cannot do electrical work.",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      matched: true,
      declined: true,
      thankYouSent: true,
    });
    expect(enqueueMock).not.toHaveBeenCalled();
    matchInboundReplyMock.mockReset();
    captureReplyMock.mockReset();
  });

  it("returns 500 (retriable) when the call-prep enqueue fails after capture", async () => {
    matchInboundReplyMock.mockImplementation(async () => ({
      comm: {
        id: "c1",
        subcontractor_id: "s1",
        opportunity_id: "o1",
        company_name: "Sub",
        sub_email: "sub@x.test",
        opportunity_title: "Job",
      },
      strongMatch: true,
    }));
    captureReplyMock.mockImplementation(async () => ({
      subId: "s1",
      companyName: "Sub",
      extracted: {
        intent: "quote",
        isQuote: true,
        quoteAmount: 1000,
        paymentTerms: null,
        notes: null,
        companyName: null,
        canPerform: true,
        capabilityNotes: null,
        tradesMentioned: [],
        method: "ai",
      },
      quoteSaved: true,
      quoteSkippedExisting: false,
      senderVerified: true,
      trade: null,
      duplicate: false,
      declined: false,
      thankYouSent: false,
    }));
    enqueueMock.mockRejectedValueOnce(new Error("queue down"));
    const res = await POST(
      signedRequest({
        type: "email.received",
        data: { email_id: "rcv_q", from: "sub@x.test", to: ["info@brostco.com"], text: "quote $1,000" },
      })
    );
    expect(res.status).toBe(500);
    matchInboundReplyMock.mockReset();
    captureReplyMock.mockReset();
  });

  it("ignores non-inbound event types", async () => {
    const res = await POST(signedRequest({ type: "email.sent", data: {} }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: "email.sent" });
  });
});
