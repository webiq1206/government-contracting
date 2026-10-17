import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ messageId: "mail-1" })),
  alert: vi.fn(async () => ({ sid: "sms-1" })),
  digestTo: "",
}));

vi.mock("../lib/integrations/system-mail", () => ({
  systemMail: { send: mocks.send },
}));
vi.mock("../lib/integrations/twilio", () => ({
  sms: { alert: mocks.alert },
}));
vi.mock("../lib/config", () => ({
  config: {
    systemMail: {
      get digestTo() {
        return mocks.digestTo;
      },
    },
  },
}));

import { deliverOutageAlert } from "../lib/outage-alert";

beforeEach(() => {
  mocks.send.mockClear();
  mocks.alert.mockClear();
  mocks.digestTo = "";
});

describe("outage alert address", () => {
  it("uses DIGEST_EMAIL_TO when it is set", async () => {
    mocks.digestTo = "hello@brostco.com";
    const sent = await deliverOutageAlert({ subject: "Pursue work is waiting", text: "Work is waiting." });
    expect(sent).toBe("email");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@brostco.com" }));
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("falls back to hello@brostco.com when DIGEST_EMAIL_TO is unset, and does not text", async () => {
    mocks.digestTo = "  ";
    const sent = await deliverOutageAlert({ subject: "Pursue work is waiting", text: "Work is waiting." });
    expect(sent).toBe("email");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@brostco.com" }));
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
