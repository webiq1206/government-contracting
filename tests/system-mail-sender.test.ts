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
  sender:
    | { from: string; replyTo: string; connected: boolean; unknown?: boolean }
    | Error;
  systemMailFrom?: string;
  transportError?: Error;
}) {
  vi.resetModules();
  if (opts.systemMailFrom) process.env.SYSTEM_MAIL_FROM = opts.systemMailFrom;
  else delete process.env.SYSTEM_MAIL_FROM;

  const sends: Sent[] = [];
  vi.doMock("@/lib/integrations/gmail", () => ({
    gmail: {
      send: async (p: Sent) => {
        sends.push(p);
        if (opts.transportError) throw opts.transportError;
        return { messageId: "m1", rfc822MessageId: "<m1@mail.example>" };
      },
      isConnected: async () => true,
      canAuthenticate: async () => true,
    },
  }));
  vi.doMock("../lib/integrations/gmail", () => ({
    gmail: {
      send: async (p: Sent) => {
        sends.push(p);
        if (opts.transportError) throw opts.transportError;
        return { messageId: "m1", rfc822MessageId: "<m1@mail.example>" };
      },
      isConnected: async () => true,
      canAuthenticate: async () => true,
    },
  }));
  vi.doMock("../lib/domain/sender-identity", () => ({
    resolveOutreachSender: async () => {
      if (opts.sender instanceof Error) throw opts.sender;
      return opts.sender;
    },
  }));
  vi.doMock("@/lib/domain/sender-identity", () => ({
    resolveOutreachSender: async () => {
      if (opts.sender instanceof Error) throw opts.sender;
      return opts.sender;
    },
  }));

  const { systemMail } = await import("../lib/integrations/system-mail");
  return { systemMail, sends };
}

afterEach(() => {
  vi.restoreAllMocks();
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
      // A database sender lookup is unnecessary when the deployment has made
      // the platform identity explicit, and must not block this path.
      sender: new Error("identity table unavailable"),
      systemMailFrom: "BROST CO Alerts <alerts@brostco.com>",
    });
    await systemMail.send({ to: "owner@example.com", subject: "Reset", text: "link" });
    expect(sends[0].from).toBe("BROST CO Alerts <alerts@brostco.com>");
    await expect(systemMail.deliverable()).resolves.toBe(true);
  });

  it("refuses to send when the identity cannot be read", async () => {
    const { systemMail, sends } = await loadSystemMail({
      sender: { from: "", replyTo: "", connected: false, unknown: true },
    });
    const res = await systemMail.send({
      to: "owner@example.com",
      subject: "Reset",
      text: "link",
    });
    expect(res).toMatchObject({
      disabled: true,
      error: expect.stringContaining("No email was sent"),
    });
    expect(sends).toHaveLength(0);
    await expect(systemMail.deliverable()).rejects.toThrow(
      "platform sender identity could not be checked"
    );
  });

  it("refuses to send when no verified platform identity is configured", async () => {
    const { systemMail, sends } = await loadSystemMail({
      sender: { from: "", replyTo: "", connected: false },
    });

    const res = await systemMail.send({
      to: "owner@example.com",
      subject: "Reset",
      text: "link",
    });

    expect(res).toMatchObject({
      disabled: true,
      error: expect.stringContaining("No verified platform sender identity"),
    });
    expect(sends).toHaveLength(0);
    await expect(systemMail.deliverable()).resolves.toBe(false);
  });

  it("converts a thrown identity lookup into an actionable refusal", async () => {
    const { systemMail, sends } = await loadSystemMail({
      sender: new Error("database unavailable"),
    });

    const res = await systemMail.send({
      to: "owner@example.com",
      subject: "Reset",
      text: "link",
    });

    expect(res.error).toContain("settings could not be read");
    expect(sends).toHaveLength(0);
  });

  it("returns an actionable result when the transport connection read throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { systemMail } = await loadSystemMail({
      sender: {
        from: "BROST CO <hello@brostco.com>",
        replyTo: "hello@brostco.com",
        connected: true,
      },
      transportError: new Error("token row unavailable"),
    });

    await expect(
      systemMail.send({ to: "owner@example.com", subject: "Reset", text: "link" })
    ).resolves.toMatchObject({
      error: expect.stringContaining("no delivery was confirmed"),
    });
    expect(log).toHaveBeenCalled();
  });

  it("returns the RFC822 Message-ID needed to match delivery failures", async () => {
    const { systemMail } = await loadSystemMail({
      sender: {
        from: "BROST CO <hello@brostco.com>",
        replyTo: "hello@brostco.com",
        connected: true,
      },
    });

    const result = await systemMail.send({
      to: "owner@example.com",
      subject: "Morning recap",
      text: "Summary",
    });

    expect(result).toMatchObject({
      messageId: "m1",
      rfc822MessageId: "<m1@mail.example>",
    });
  });
});
