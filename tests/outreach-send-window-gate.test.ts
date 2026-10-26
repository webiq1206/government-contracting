/**
 * The provider choke point uses the real America/Boise gate.
 *
 * The clock is fake. The timezone is not: gmail.send calls outreachWindowRefusal,
 * which reads Intl with timeZone America/Boise. A UTC hour check would send at
 * Monday 14:59Z (UTC hour 14). A fixed MDT offset would send at Tuesday
 * 2026-11-03 15:00Z. Both must be held, and neither may touch Gmail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  send: vi.fn(),
  get: vi.fn(),
  paused: false,
  zone: null as string | null,
  recipient: null as { state: string | null; city: string | null } | null,
}));
vi.mock("../lib/config", () => ({
  config: {
    gmail: { configured: true, clientId: "test", clientSecret: "test", sender: null },
    database: { isIsolatedDev: false },
    email: {},
    appUrl: "https://brostco.com",
  },
}));
vi.mock("../lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async (sql: string) => {
    const text = String(sql);
    if (text.includes("from subcontractors")) return mocks.recipient;
    if (text.includes("from organizations")) return { timezone: mocks.zone };
    return { data: { refresh_token: "test-only" } };
  }),
  transaction: async (fn: (client: { query: () => Promise<{ rows: [] }> }) => unknown) =>
    fn({ query: async () => ({ rows: [] }) }),
}));
vi.mock("../lib/integration-settings", () => ({
  encryptSecret: (v: string) => v,
  decryptSecret: (v: string) => v,
}));
vi.mock("../lib/app-settings", () => ({
  isAutomationStopped: async () => mocks.paused,
  AUTOMATION_PAUSED_ERROR: "Paused",
}));
vi.mock("../lib/integrations/gmail-quota", () => ({ reserveGmailQuota: async () => {} }));
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    gmail: () => ({
      users: {
        settings: { sendAs: { list: mocks.list } },
        messages: { send: mocks.send, get: mocks.get },
      },
    }),
  },
}));

import { gmail, __resetSendAsCache } from "../lib/integrations/gmail";

const params = {
  orgId: "org-1",
  to: "owner@example.com",
  from: "BrostCo <hello@brostco.com>",
  subject: "Quote request",
  html: "<p>Test</p>",
};

const HOLD = {
  disabled: true,
  retryable: true,
  outcome: "not_attempted" as const,
  heldForSendWindow: true,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.clearAllMocks();
  __resetSendAsCache();
  mocks.paused = false;
  mocks.zone = null;
  mocks.recipient = null;
  mocks.list.mockResolvedValue({
    data: {
      sendAs: [
        { sendAsEmail: "admin@brostco.com", isPrimary: true },
        { sendAsEmail: "hello@brostco.com", verificationStatus: "accepted" },
      ],
    },
  });
  mocks.send.mockResolvedValue({ data: { id: "gmail-id", threadId: "thread-id" } });
  mocks.get.mockResolvedValue({
    data: { payload: { headers: [{ name: "Message-ID", value: "<internet-id@example.com>" }] } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("gmail.send refuses outreach outside America/Boise weekday hours", () => {
  it.each([
    ["Monday 08:59 MDT", "2026-10-26T14:59:00.000Z", false],
    ["Monday 09:00 MDT", "2026-10-26T15:00:00.000Z", true],
    ["Monday 16:59 MDT", "2026-10-26T22:59:00.000Z", true],
    ["Monday 17:00 MDT", "2026-10-26T23:00:00.000Z", false],
    ["Saturday 10:00 MDT", "2026-10-24T16:00:00.000Z", false],
    ["Sunday 10:00 MDT", "2026-10-25T16:00:00.000Z", false],
    ["Tuesday 08:00 MST after fall-back", "2026-11-03T15:00:00.000Z", false],
    ["Tuesday 09:00 MST after fall-back", "2026-11-03T16:00:00.000Z", true],
  ])("%s", async (_label, iso, open) => {
    vi.setSystemTime(new Date(iso));
    const stamp = vi.fn(async () => {});
    const result = await gmail.send({ ...params, beforeProviderSend: stamp });
    if (open) {
      expect(result).toMatchObject({ outcome: "accepted", messageId: "gmail-id" });
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(stamp).toHaveBeenCalledTimes(1);
    } else {
      expect(result).toMatchObject({ ...HOLD, error: expect.stringContaining("America/Boise") });
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
      expect(stamp).not.toHaveBeenCalled();
    }
  });

  it("opens New York and holds Los Angeles at the same UTC instant", async () => {
    vi.setSystemTime(new Date("2026-10-26T14:30:00.000Z"));
    mocks.zone = "America/New_York";
    expect(await gmail.send(params)).toMatchObject({ outcome: "accepted", messageId: "gmail-id" });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    __resetSendAsCache();
    mocks.zone = "America/Los_Angeles";
    const held = await gmail.send(params);
    expect(held).toMatchObject({ ...HOLD, error: expect.stringContaining("America/Los_Angeles") });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("holds New York and opens Los Angeles later the same Monday", async () => {
    vi.setSystemTime(new Date("2026-10-26T21:30:00.000Z"));
    mocks.zone = "America/New_York";
    expect(await gmail.send(params)).toMatchObject({
      ...HOLD,
      error: expect.stringContaining("America/New_York"),
    });
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.zone = "America/Los_Angeles";
    expect(await gmail.send(params)).toMatchObject({ outcome: "accepted", messageId: "gmail-id" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("sends a password reset on Saturday because system mail is transactional", async () => {
    vi.setSystemTime(new Date("2026-10-24T16:00:00.000Z"));
    expect(await gmail.send({ ...params, transactional: true })).toMatchObject({
      outcome: "accepted",
      messageId: "gmail-id",
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("opens a New York recipient and holds a Los Angeles recipient at the same instant", async () => {
    vi.setSystemTime(new Date("2026-10-26T14:30:00.000Z"));
    mocks.zone = "America/Los_Angeles";
    mocks.recipient = { state: "NY", city: "Albany" };
    expect(await gmail.send({ ...params, subcontractorId: "sub-ny" })).toMatchObject({
      outcome: "accepted",
      messageId: "gmail-id",
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    __resetSendAsCache();
    mocks.zone = "America/New_York";
    mocks.recipient = { state: "CA", city: "Oakland" };
    const held = await gmail.send({ ...params, subcontractorId: "sub-ca" });
    expect(held).toMatchObject({ ...HOLD, error: expect.stringContaining("America/Los_Angeles") });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("uses Chicago for an unknown recipient and Boise when the account zone is unset", async () => {
    vi.setSystemTime(new Date("2026-10-26T14:30:00.000Z"));
    mocks.zone = "America/Chicago";
    mocks.recipient = { state: "TX", city: null };
    expect(await gmail.send({ ...params, subcontractorId: "sub-tx" })).toMatchObject({
      outcome: "accepted",
      messageId: "gmail-id",
    });

    vi.clearAllMocks();
    __resetSendAsCache();
    mocks.zone = null;
    mocks.recipient = { state: null, city: "Houston" };
    const held = await gmail.send({ ...params, subcontractorId: "sub-unknown" });
    expect(held).toMatchObject({ ...HOLD, error: expect.stringContaining("America/Boise") });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("holds a Boise recipient after the fall-back even when the account is on Eastern time", async () => {
    vi.setSystemTime(new Date("2026-11-03T15:00:00.000Z"));
    mocks.zone = "America/New_York";
    mocks.recipient = { state: "ID", city: "Boise" };
    const held = await gmail.send({ ...params, subcontractorId: "sub-boise" });
    expect(held).toMatchObject({ ...HOLD, error: expect.stringContaining("America/Boise") });
    expect(mocks.send).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-11-03T16:00:00.000Z"));
    expect(await gmail.send({ ...params, subcontractorId: "sub-boise" })).toMatchObject({
      outcome: "accepted",
      messageId: "gmail-id",
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("still prefers the pause switch when both would refuse", async () => {
    mocks.paused = true;
    vi.setSystemTime(new Date("2026-10-26T06:00:00.000Z"));
    expect(await gmail.send(params)).toMatchObject({ disabled: true, error: "Paused" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
