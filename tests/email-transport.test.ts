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

vi.mock("../lib/integrations/resend", () => ({
  email: {
    enabled: vi.fn(() => true),
    send: vi.fn(),
  },
}));

vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: vi.fn(async () => false),
  AUTOMATION_PAUSED_ERROR: "Automation is fully paused.",
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { gmail } from "../lib/integrations/gmail";
import { email as resend } from "../lib/integrations/resend";
import { config } from "../lib/config";
import {
  sendOutreachEmail,
  OUTREACH_SENDER,
  OUTREACH_EMAIL,
} from "../lib/integrations/email-transport";

const mockGmailSend = gmail.send as ReturnType<typeof vi.fn>;
const mockGmailConnected = gmail.isConnected as ReturnType<typeof vi.fn>;
const mockResendSend = resend.send as ReturnType<typeof vi.fn>;

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

  it("falls back to the platform identity, ignoring RESEND_OUTREACH_FROM, when no tenant is resolvable", async () => {
    // Simulate a non-default RESEND_OUTREACH_FROM — the transport must ignore it
    const config = await import("../lib/config");
    const originalGetter = Object.getOwnPropertyDescriptor(config.config.resend, "outreachFrom");
    Object.defineProperty(config.config.resend, "outreachFrom", {
      get: () => "ACME <noreply@acme.com>",
      configurable: true,
    });
    try {
      await sendOutreachEmail(BASE_PARAMS);
      // With no tenant row reachable, the platform identity is used rather
      // than RESEND_OUTREACH_FROM or the shared sending domain.
      expect(mockGmailSend.mock.calls[0][0].from).toBe("BROSTCO <info@brostco.com>");
      expect(mockGmailSend.mock.calls[0][0].replyTo).toBe("info@brostco.com");
    } finally {
      if (originalGetter) {
        Object.defineProperty(config.config.resend, "outreachFrom", originalGetter);
      }
    }
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

describe("sendOutreachEmail — Resend path", () => {
  beforeEach(() => {
    mockGmailConnected.mockResolvedValue(false);
    mockResendSend.mockResolvedValue({ id: "resend-msg-1" });
    // Hermetic: do not depend on RESEND_API_KEY being present in the test env.
    vi.spyOn(config.resend, "enabled", "get").mockReturnValue(true);
  });

  it("sets From to the literal BROSTCO <info@brostco.com>", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    expect(mockResendSend).toHaveBeenCalledOnce();
    expect(mockResendSend.mock.calls[0][0].from).toBe("BROSTCO <info@brostco.com>");
  });

  it("sets Reply-To to the literal info@brostco.com (no plus-address token)", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    const call = mockResendSend.mock.calls[0][0];
    expect(call.replyTo).toBe("info@brostco.com");
    expect(call.replyTo).not.toMatch(/\+t/);
  });

  it("falls back to the platform identity, ignoring RESEND_OUTREACH_FROM, when no tenant is resolvable", async () => {
    const config = await import("../lib/config");
    const originalGetter = Object.getOwnPropertyDescriptor(config.config.resend, "outreachFrom");
    Object.defineProperty(config.config.resend, "outreachFrom", {
      get: () => "ACME <noreply@acme.com>",
      configurable: true,
    });
    try {
      await sendOutreachEmail(BASE_PARAMS);
      expect(mockResendSend.mock.calls[0][0].from).toBe("BROSTCO <info@brostco.com>");
      expect(mockResendSend.mock.calls[0][0].replyTo).toBe("info@brostco.com");
    } finally {
      if (originalGetter) {
        Object.defineProperty(config.config.resend, "outreachFrom", originalGetter);
      }
    }
  });

  it("returns provider and messageId on success", async () => {
    const result = await sendOutreachEmail(BASE_PARAMS);
    expect(result.provider).toBe("resend");
    expect(result.messageId).toBe("resend-msg-1");
    expect(result.threadId).toBeNull();
  });

  it("returns disabled when Resend becomes unavailable", async () => {
    mockResendSend.mockResolvedValue({ disabled: true });
    const result = await sendOutreachEmail(BASE_PARAMS);
    expect(result.provider).toBeNull();
    expect(result.disabled).toBe(true);
  });

  it("passes filename, PDF bytes, and contentType so recipients can open the file", async () => {
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
    const sent = mockResendSend.mock.calls[0][0].attachments;
    expect(sent).toHaveLength(1);
    expect(sent[0].filename).toBe("attachment.pdf");
    expect(sent[0].contentType).toBe("application/pdf");
    expect(Buffer.from(sent[0].content).equals(pdf)).toBe(true);
  });
});

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
