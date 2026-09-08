/**
 * Unit tests for sendOutreachEmail. From and Reply-To must come from the exact
 * tenant's verified Gmail identity. A missing tenant or identity must hold the
 * message instead of borrowing the platform address.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock the two transport integrations ───────────────────────────────────

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    isConnected: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock("../lib/domain/sender-identity", () => ({
  resolveOutreachSender: vi.fn(),
}));

vi.mock("../lib/tenant", () => ({
  tryResolveTenantOrgId: vi.fn(async () => null),
}));

vi.mock("../lib/impersonation", () => ({ currentImpersonator: vi.fn(async () => null) }));
vi.mock("../lib/domain/email-suppression", () => ({
  isSuppressed: vi.fn(async () => false),
}));
vi.mock("../lib/billing/trial-limits", () => ({
  checkTrialQuota: vi.fn(async () => ({ allowed: true, message: "Allowed" })),
}));

vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: vi.fn(async () => false),
  isAutomationStopped: vi.fn(async () => false),
  isPlatformAutomationPaused: async () => false,
  AUTOMATION_PAUSED_ERROR: "Automation is fully paused.",
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { gmail } from "../lib/integrations/gmail";
import { resolveOutreachSender } from "../lib/domain/sender-identity";
import { config } from "../lib/config";
import {
  sendOutreachEmail,
  OUTREACH_SENDER,
  OUTREACH_EMAIL,
} from "../lib/integrations/email-transport";

const mockGmailSend = gmail.send as ReturnType<typeof vi.fn>;
const mockGmailConnected = gmail.isConnected as ReturnType<typeof vi.fn>;
const mockResolveSender = resolveOutreachSender as ReturnType<typeof vi.fn>;

const BASE_PARAMS = {
  to: "sub@example.com",
  subject: "Project Outreach",
  html: "<p>Hello</p>",
  text: "Hello",
  trackingId: "0b7f9a2c-9f1e-4c1d-8b3a-1234567890ab",
  orgId: "11111111-2222-4333-8444-555555555555",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSender.mockResolvedValue({
    from: "Acme Builders <bids@acme.com>",
    replyTo: "bids@acme.com",
    connected: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("legacy platform identity constants", () => {
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

  it("sets From to the tenant's verified sender", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    expect(mockGmailSend).toHaveBeenCalledOnce();
    expect(mockGmailSend.mock.calls[0][0].from).toBe("Acme Builders <bids@acme.com>");
  });

  it("sets Reply-To to the same tenant mailbox the platform reads", async () => {
    await sendOutreachEmail(BASE_PARAMS);
    expect(mockGmailSend.mock.calls[0][0].replyTo).toBe("bids@acme.com");
  });

  it("holds the message when no tenant is resolvable", async () => {
    const result = await sendOutreachEmail({ ...BASE_PARAMS, orgId: undefined });

    expect(result).toMatchObject({
      provider: null,
      blocked: true,
      error: expect.stringContaining("account that owns this outreach could not be established"),
    });
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("holds the message when the identity lookup is unreadable", async () => {
    mockResolveSender.mockResolvedValue({
      from: "",
      replyTo: "",
      connected: false,
      unknown: true,
    });

    const result = await sendOutreachEmail(BASE_PARAMS);

    expect(result.error).toContain("sender identity could not be checked");
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("holds the message when the connected tenant has no complete identity", async () => {
    mockResolveSender.mockResolvedValue({ from: "", replyTo: "", connected: false });

    const result = await sendOutreachEmail(BASE_PARAMS);

    expect(result.error).toContain("No verified sender identity");
    expect(mockGmailSend).not.toHaveBeenCalled();
  });

  it("does not exempt the founding tenant from the verified identity requirement", async () => {
    mockResolveSender.mockResolvedValue({
      from: "",
      replyTo: "",
      connected: false,
      unknown: true,
    });

    const result = await sendOutreachEmail({
      ...BASE_PARAMS,
      orgId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result).toMatchObject({
      provider: null,
      disabled: true,
      error: expect.stringContaining("sender identity could not be checked"),
    });
    expect(mockGmailSend).not.toHaveBeenCalled();
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

  it("reports unconfirmed delivery when the Gmail call does not return", async () => {
    mockGmailSend.mockRejectedValue(new Error("connection state unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendOutreachEmail(BASE_PARAMS);

    expect(result).toMatchObject({
      provider: null,
      error: expect.stringContaining("Check the Gmail Sent folder before retrying"),
    });
    expect(log).toHaveBeenCalled();
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
