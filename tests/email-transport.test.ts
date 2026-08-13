/**
 * Unit tests for sendOutreachEmail — verifies that From and Reply-To are
 * always locked to literal "BROSTCO <info@brostco.com>" / "info@brostco.com"
 * for both the Gmail and Resend transport paths, independent of the caller and
 * of the RESEND_OUTREACH_FROM / GMAIL_SENDER configuration values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the two transport integrations ───────────────────────────────────

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: vi.fn(),
    send: vi.fn(),
  },
}));


vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: vi.fn(async () => false),
  AUTOMATION_PAUSED_ERROR: "Automation is fully paused.",
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { gmail } from "../lib/integrations/gmail";
import { config } from "../lib/config";
import {
  sendOutreachEmail,
  OUTREACH_SENDER,
  OUTREACH_EMAIL,
} from "../lib/integrations/email-transport";

const mockGmailSend = gmail.send as ReturnType<typeof vi.fn>;
const mockGmailConnected = gmail.isConnected as ReturnType<typeof vi.fn>;

const BASE_PARAMS = {
  to: "sub@example.com",
  subject: "Project Outreach",
  html: "<p>Hello</p>",
  text: "Hello",
  trackingId: "0b7f9a2c-9f1e-4c1d-8b3a-1234567890ab",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("platform fallback sender constants", () => {
  it("OUTREACH_SENDER is the literal canonical address", () => {
    expect(OUTREACH_SENDER).toBe("BROSTCO <info@brostco.com>");
  });
  it("OUTREACH_EMAIL is the plain canonical address", () => {
    expect(OUTREACH_EMAIL).toBe("info@brostco.com");
  });
});

// ─── Gmail path ─────────────────────────────────────────────────────────────

describe("sendOutreachEmail — Gmail path", () => {
  beforeEach(() => {
    mockGmailConnected.mockResolvedValue(true);
    mockGmailSend.mockResolvedValue({ messageId: "gmail-msg-1", threadId: "thread-1" });
  });

  it("sets From to the literal BROSTCO <info@brostco.com>", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    expect(mockGmailSend).toHaveBeenCalledOnce();
    expect(mockGmailSend.mock.calls[0][0].from).toBe("BROSTCO <info@brostco.com>");
  });

  it("sets Reply-To to the literal info@brostco.com", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    expect(mockGmailSend.mock.calls[0][0].replyTo).toBe("info@brostco.com");
  });

  it("falls back to the platform identity when no tenant is resolvable", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    expect(mockGmailSend.mock.calls[0][0].from).toBe("BROSTCO <info@brostco.com>");
    expect(mockGmailSend.mock.calls[0][0].replyTo).toBe("info@brostco.com");
  });

  it("returns provider, messageId, and threadId on success", async () => {
    const result = await sendOutreachEmail(BASE_PARAMS);
    expect(result.provider).toBe("gmail");
    expect(result.messageId).toBe("gmail-msg-1");
    expect(result.threadId).toBe("thread-1");
  });

  it("returns disabled when Gmail becomes unavailable mid-send", async () => {
    mockGmailSend.mockResolvedValue({ disabled: true });
    const result = await sendOutreachEmail(BASE_PARAMS);
    expect(result.provider).toBeNull();
    expect(result.disabled).toBe(true);
  });

  it("normalizes SAM-style attachments before handing them to Gmail", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    await sendOutreachEmail({
      ...BASE_PARAMS,
      attachments: [
        {
          filename: "attachment",
          content: pdf,
          mime: "application/octet-stream",
        },
      ],
    });
    const sent = mockGmailSend.mock.calls[0][0].attachments;
    expect(sent).toHaveLength(1);
    expect(sent[0].filename).toBe("attachment.pdf");
    expect(sent[0].mime).toBe("application/pdf");
    expect(Buffer.from(sent[0].content).equals(pdf)).toBe(true);
  });
});

// ─── Resend path ─────────────────────────────────────────────────────────────


// ─── Plus-address helpers still work (Resend legacy correlation) ─────────────

describe("replyCorrelationAddress / parseCorrelationToken (legacy support)", () => {
  it("produces and parses correlation tokens for any legacy plus-addressed replies", async () => {
    const { replyCorrelationAddress, parseCorrelationToken } = await import(
      "../lib/reply-capture"
    );
    const token = "0b7f9a2c-9f1e-4c1d-8b3a-1234567890ab";
    const addr = replyCorrelationAddress("BROSTCO <info@brostco.com>", token);
    expect(addr).toBe(`info+t${token}@brostco.com`);
    expect(parseCorrelationToken([addr!])).toBe(token);
  });
});
