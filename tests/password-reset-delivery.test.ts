/**
 * A reset request must never claim to have sent something it could not send.
 *
 * The forgot-password form is the last way back into an account, and it used to
 * answer "check your email" whether or not the site had any way to send mail.
 * During an email outage that is indistinguishable from a working reset: the
 * person waits for a link that was never put on the wire, and nothing anywhere
 * says so.
 *
 * The counterweight is account enumeration. Whether the platform inbox can send
 * at all is a fact about us: it is read before any account is looked up and
 * reads identically for an address that has an account and one that does not,
 * so it is safe to report. Whether one particular send succeeded is only
 * knowable for an address that has an account, so it stays quiet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const deliverable = vi.fn(async () => true);
const send = vi.fn(async () => ({ messageId: "m1" }));
const findUserByLoginEmail = vi.fn(async (email: string) =>
  email === "real@example.invalid"
    ? { id: "u1", email: "real@example.invalid", name: "Real", role: "operator" }
    : null
);

vi.mock("../lib/integrations/system-mail", () => ({
  systemMail: {
    deliverable: (...args: unknown[]) => deliverable(...(args as [])),
    send: (...args: unknown[]) => send(...(args as [])),
  },
}));
vi.mock("../lib/db", () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
  queryOne: vi.fn(async () => null),
}));
vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));
// isProd is fixed when config is imported, so the production-only branch needs
// a config that can be moved between cases.
const cfg = vi.hoisted(() => ({ isProd: false, appUrl: "http://localhost:3000" }));
vi.mock("../lib/config", () => ({ config: cfg }));
vi.mock("../lib/auth", () => ({
  hashPassword: (p: string) => `hashed:${p}`,
  findUserByLoginEmail: (...args: unknown[]) =>
    findUserByLoginEmail(...(args as [string])),
}));

import { requestPasswordReset } from "../lib/auth-password-reset";

beforeEach(() => {
  vi.clearAllMocks();
  deliverable.mockResolvedValue(true);
  send.mockResolvedValue({ messageId: "m1" });
  cfg.isProd = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("password reset delivery reporting", () => {
  it("reports a link as sent when the platform inbox is connected", async () => {
    const res = await requestPasswordReset("real@example.invalid");
    expect(res.delivery).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable, and sends nothing, when the platform inbox cannot send", async () => {
    // Covers both an inbox that was never connected and one whose stored health
    // says a real call already failed (a revoked or expired grant).
    deliverable.mockResolvedValue(false);
    const res = await requestPasswordReset("real@example.invalid");
    expect(res.delivery).toBe("unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("gives the same answer for an address with no account", async () => {
    // The whole value of reporting transport state is that it says nothing
    // about accounts. If these two ever diverge, the endpoint has become an
    // account oracle.
    const real = await requestPasswordReset("real@example.invalid");
    const fake = await requestPasswordReset("nobody@example.invalid");
    expect(fake.delivery).toBe(real.delivery);

    deliverable.mockResolvedValue(false);
    const realDown = await requestPasswordReset("real@example.invalid");
    const fakeDown = await requestPasswordReset("nobody@example.invalid");
    expect(fakeDown.delivery).toBe(realDown.delivery);
    expect(realDown.delivery).toBe("unavailable");
  });

  it("does not throw when the send throws, and answers as if nothing was wrong", async () => {
    // The send only happens for an address that has an account, so its outcome
    // must not reach the answer: "no link was sent" here, where an unknown
    // address is told "sent", is a way to test which addresses have accounts.
    send.mockRejectedValue(new Error("socket hang up"));
    expect((await requestPasswordReset("real@example.invalid")).delivery).toBe("sent");
  });

  it("keeps a provider error out of the answer, and leaves it to the inbox's own health", async () => {
    // The transport's failure shape is an error with no `disabled` flag. The
    // send itself records the failure against the connection, so the next
    // request reads it as an inbox that cannot send, for every address at once,
    // rather than this one request answering differently from all the others.
    send.mockResolvedValue({ error: "Gmail API: invalid_grant" });
    expect((await requestPasswordReset("real@example.invalid")).delivery).toBe("sent");

    deliverable.mockResolvedValue(false);
    expect((await requestPasswordReset("nobody@example.invalid")).delivery).toBe("unavailable");
    expect((await requestPasswordReset("real@example.invalid")).delivery).toBe("unavailable");
  });

  it("answers the same for a known and an unknown address in either order during an outage", async () => {
    // Probing an unknown address for a baseline and then a candidate is the
    // ordering that exposes an account if a failing send changes the answer.
    send.mockRejectedValue(new Error("provider down"));
    const unknownFirst = [
      (await requestPasswordReset("nobody@example.invalid")).delivery,
      (await requestPasswordReset("real@example.invalid")).delivery,
    ];
    const knownFirst = [
      (await requestPasswordReset("real@example.invalid")).delivery,
      (await requestPasswordReset("nobody@example.invalid")).delivery,
    ];

    // Whichever address is asked about first, the pair of answers is the same,
    // so nothing in the sequence says which of the two has an account.
    expect(unknownFirst).toEqual(knownFirst);
  });

  it("answers the same for a known and an unknown address asked at the same time", async () => {
    send.mockRejectedValue(new Error("provider down"));
    const [known, unknown] = await Promise.all([
      requestPasswordReset("real@example.invalid"),
      requestPasswordReset("nobody@example.invalid"),
    ]);
    expect(known.delivery).toBe(unknown.delivery);
  });

  it("keeps a recipient-specific rejection out of the answer", async () => {
    // A provider refusing one mailbox says nothing about the transport, and
    // saying so out loud would say that this address has an account.
    send.mockResolvedValue({ error: "550 5.1.1 recipient rejected" });
    expect((await requestPasswordReset("real@example.invalid")).delivery).toBe("sent");
  });

  it("says nothing different when the transport refuses the send mid-request", async () => {
    // Quota spent, automation paused, the inbox dropping out: real reasons for
    // no link to exist, but all of them are only observable for an address that
    // has an account, so the answer stays the one everybody else gets.
    send.mockResolvedValue({ disabled: true, error: "Gmail became unavailable." });
    expect((await requestPasswordReset("real@example.invalid")).delivery).toBe("sent");
  });

  it("touches no account at all in production when nothing can be sent", async () => {
    // The database being unreachable is what takes the transport down in the
    // first place, so this path must not depend on a lookup succeeding.
    cfg.isProd = true;
    deliverable.mockResolvedValue(false);
    const res = await requestPasswordReset("real@example.invalid");
    expect(res.delivery).toBe("unavailable");
    expect(findUserByLoginEmail).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("mails the address that was typed, not the account's own address", async () => {
    // Someone whose working inbox is an alias must receive the link there.
    findUserByLoginEmail.mockResolvedValueOnce({
      id: "u1",
      email: "canonical@example.invalid",
      name: "Real",
      role: "operator",
    });
    await requestPasswordReset("Alias@Example.Invalid");
    expect(send.mock.calls[0][0]).toMatchObject({ to: "alias@example.invalid" });
  });
});
