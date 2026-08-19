/**
 * The reset endpoint says whether a link could be sent. That answer must not be
 * movable by asking about a particular address.
 *
 * The subtle version of the leak is not the response itself but the state
 * behind it: a send only happens for an address that has an account, and a
 * failed send records the connection as unhealthy. If the public answer read
 * that stored health, an attacker could ask about a candidate address and then
 * about a control address, and learn from the change that the candidate caused
 * a send.
 *
 * This exercises that exact sequence against a Gmail transport that really does
 * write its error state, with the real system-mail layer in between.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg = vi.hoisted(() => ({
  isProd: false,
  appUrl: "http://localhost:3000",
  systemMail: { from: null as string | null },
}));
vi.mock("../lib/config", () => ({ config: cfg }));

// A transport that behaves like the real one: a failing send marks the stored
// connection, and the grant itself keeps working.
const transport = vi.hoisted(() => ({
  storedStatus: "connected" as string,
  grantValid: true,
  sendFails: false,
  sends: 0,
}));

vi.mock("../lib/integrations/gmail", () => ({
  gmail: {
    async canAuthenticate() {
      return transport.grantValid;
    },
    async isConnected() {
      return transport.storedStatus !== "revoked";
    },
    async connection() {
      return {
        connected: transport.storedStatus !== "revoked",
        email: "platform@example.invalid",
        status: transport.storedStatus,
        lastError: null,
      };
    },
    async send() {
      transport.sends += 1;
      if (transport.sendFails) {
        // Exactly what the real client does on a failed call.
        transport.storedStatus = "error";
        return { error: "550 5.1.1 recipient rejected" };
      }
      return { messageId: `m${transport.sends}` };
    },
  },
}));

vi.mock("../lib/db", () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
  queryOne: vi.fn(async () => null),
}));
vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));
vi.mock("../lib/auth", () => ({
  hashPassword: (p: string) => `hashed:${p}`,
  findUserByLoginEmail: async (email: string) =>
    email === "real@example.invalid"
      ? { id: "u1", email: "real@example.invalid", name: "Real", role: "operator" }
      : null,
}));

import { requestPasswordReset } from "../lib/auth-password-reset";

const ask = async (email: string) => (await requestPasswordReset(email)).delivery;

beforeEach(() => {
  transport.storedStatus = "connected";
  transport.grantValid = true;
  transport.sendFails = false;
  transport.sends = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("a failed send cannot change what anyone else is told", () => {
  it("answers a control address the same before and after a real account's send fails", async () => {
    transport.sendFails = true;
    const controlBefore = await ask("nobody@example.invalid");
    expect(await ask("real@example.invalid")).toBe(controlBefore);

    // The send failed and marked the connection, which is what the attacker
    // would be reading.
    expect(transport.storedStatus).toBe("error");
    expect(await ask("nobody@example.invalid")).toBe(controlBefore);
    expect(await ask("real@example.invalid")).toBe(controlBefore);
  });

  it("gives the same sequence whichever address is probed first", async () => {
    transport.sendFails = true;
    const unknownFirst = [await ask("nobody@example.invalid"), await ask("real@example.invalid")];

    transport.storedStatus = "connected";
    const knownFirst = [await ask("real@example.invalid"), await ask("nobody@example.invalid")];

    expect(knownFirst).toEqual(unknownFirst);
  });

  it("still reports unavailable when our own grant is dead, for every address alike", async () => {
    // The case worth telling someone about: nothing can be sent to anyone, and
    // no request caused it.
    transport.grantValid = false;
    expect(await ask("real@example.invalid")).toBe("unavailable");
    expect(await ask("nobody@example.invalid")).toBe("unavailable");
    expect(transport.sends).toBe(0);
  });

  it("reports sent for every address while the grant works", async () => {
    expect(await ask("real@example.invalid")).toBe("sent");
    expect(await ask("nobody@example.invalid")).toBe("sent");
  });
});
