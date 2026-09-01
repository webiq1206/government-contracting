/**
 * Platform mail goes out from the same address as outreach.
 *
 * A password reset or a morning recap that arrives from a different address
 * than every other email the company sends reads as a phishing attempt to the
 * recipient, and scores like one with a spam filter. So system mail uses the
 * sending address chosen for the platform's own inbox, and only an explicit
 * SYSTEM_MAIL_FROM overrides it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

interface Sent {
  from?: string;
}

async function loadSystemMail(opts: {
  sender: { from: string; replyTo: string; connected: boolean; unknown?: boolean };
  systemMailFrom?: string;
}) {
  vi.resetModules();
  if (opts.systemMailFrom) process.env.SYSTEM_MAIL_FROM = opts.systemMailFrom;
  else delete process.env.SYSTEM_MAIL_FROM;

  const sends: Sent[] = [];
  vi.doMock("@/lib/integrations/gmail", () => ({
    gmail: {
      send: async (p: Sent) => {
        sends.push(p);
        return { messageId: "m1" };
      },
      isConnected: async () => true,
      canAuthenticate: async () => true,
    },
  }));
  vi.doMock("../lib/integrations/gmail", () => ({
    gmail: {
      send: async (p: Sent) => {
        sends.push(p);
        return { messageId: "m1" };
      },
      isConnected: async () => true,
      canAuthenticate: async () => true,
    },
  }));
  vi.doMock("../lib/domain/sender-identity", () => ({
    resolveOutreachSender: async () => opts.sender,
  }));
  vi.doMock("@/lib/domain/sender-identity", () => ({
    resolveOutreachSender: async () => opts.sender,
  }));

  const { systemMail } = await import("../lib/integrations/system-mail");
  return { systemMail, sends };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../lib/integrations/gmail");
  vi.doUnmock("@/lib/integrations/gmail");
  vi.doUnmock("../lib/domain/sender-identity");
  vi.doUnmock("@/lib/domain/sender-identity");
  delete process.env.SYSTEM_MAIL_FROM;
});

describe("who a platform email comes from", () => {
  it("uses the sending address chosen for the platform inbox", async () => {
    const { systemMail, sends } = await loadSystemMail({
      sender: {
        from: "BROST CO <hello@brostco.com>",
        replyTo: "hello@brostco.com",
        connected: true,
      },
    });
    await systemMail.send({ to: "owner@example.com", subject: "Reset", text: "link" });
    expect(sends[0].from).toBe("BROST CO <hello@brostco.com>");
  });

  it("lets an explicit SYSTEM_MAIL_FROM override it", async () => {
    const { systemMail, sends } = await loadSystemMail({
      sender: {
        from: "BROST CO <hello@brostco.com>",
        replyTo: "hello@brostco.com",
        connected: true,
      },
      systemMailFrom: "BROST CO Alerts <alerts@brostco.com>",
    });
    await systemMail.send({ to: "owner@example.com", subject: "Reset", text: "link" });
    expect(sends[0].from).toBe("BROST CO Alerts <alerts@brostco.com>");
  });

  it("still sends when the identity cannot be read, rather than losing the reset", async () => {
    const { systemMail, sends } = await loadSystemMail({
      sender: { from: "", replyTo: "", connected: false, unknown: true },
    });
    const res = await systemMail.send({
      to: "owner@example.com",
      subject: "Reset",
      text: "link",
    });
    expect(res.error).toBeUndefined();
    // No From header, so Gmail falls back to the authorized account.
    expect(sends[0].from).toBeUndefined();
  });
});
