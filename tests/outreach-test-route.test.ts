import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({ auth: vi.fn(), build: vi.fn(), send: vi.fn(), log: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: m.auth }));
vi.mock("@/lib/outreach-test", () => ({ buildOutreachTest: m.build }));
vi.mock("@/lib/integrations/email-transport", () => ({ sendOutreachEmail: m.send }));
vi.mock("@/lib/logger", () => ({ logAgent: m.log }));
vi.mock("@/lib/rate-limit", () => ({ consume: m.limit }));
vi.mock("@/lib/domain/template-store", () => ({ templateHistory: vi.fn() }));
vi.mock("@/lib/domain/template-versions", () => ({ saveTemplateVersion: vi.fn() }));

import { POST } from "@/app/api/templates/[slug]/route";
const orgId = "11111111-1111-4111-8111-111111111111";
const pair = { opportunityId: "22222222-2222-4222-8222-222222222222", subcontractorId: "33333333-3333-4333-8333-333333333333", trade: "HVAC" };
const packet = { subject: "[TEST] Pricing request", html: "<p>Controlled test</p>", text: "Controlled test", attachments: [], mode: "real_bid" };
const send = (data: Record<string, unknown> = {}) => POST(new Request("https://brostco.com/api/templates/template_1_outreach", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ subject: "Pricing request", body: "Please review this pricing request.", ...data }),
}), { params: Promise.resolve({ slug: "template_1_outreach" }) });

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ orgId, user: { email: "operator@example.com", orgRole: "owner" } });
  m.build.mockResolvedValue(packet);
  m.send.mockResolvedValue({ provider: "gmail", messageId: "gmail-receipt", threadId: "thread" });
  m.limit.mockReturnValue({ ok: true });
  m.log.mockResolvedValue(undefined);
});

describe("controlled production outreach test", () => {
  it("sends exactly once to the explicit recipient and reports acceptance, not delivery", async () => {
    const res = await send({ recipient: "brostjared@gmail.com", pair });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sentTo: "brostjared@gmail.com", delivery: "provider_accepted", messageId: "gmail-receipt", mode: "real_bid" });
    expect(m.build).toHaveBeenCalledWith(orgId, expect.anything(), pair);
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.send).toHaveBeenCalledWith({ to: "brostjared@gmail.com", orgId, subject: packet.subject, html: packet.html, text: packet.text, attachments: [] });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ output: expect.objectContaining({ recipient: "brostjared@gmail.com", messageId: "gmail-receipt" }) }));
  });
  it("preserves the account-email default", async () => {
    expect((await send()).status).toBe(200);
    expect(m.send.mock.calls[0][0].to).toBe("operator@example.com");
  });
  it.each(["one@example.com,two@example.com", "one@example.com\r\nBcc: two@example.com", "not-an-email"])("rejects unsafe recipient %s", async recipient => {
    expect((await send({ recipient })).status).toBe(400);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("does not send when real bid content or package validation fails", async () => {
    m.build.mockRejectedValue(new Error("The actual bid package is not sendable. Nothing was sent."));
    expect((await send({ recipient: "brostjared@gmail.com", pair })).status).toBe(422);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("refuses false success without a receipt", async () => {
    m.send.mockResolvedValue({ provider: "gmail" });
    const res = await send();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Delivery is unconfirmed");
    expect(m.log).not.toHaveBeenCalled();
  });
  it("does not turn an audit failure after acceptance into a resend invitation", async () => {
    m.log.mockRejectedValue(new Error("audit unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send()).status).toBe(200);
    expect(m.send).toHaveBeenCalledOnce();
    log.mockRestore();
  });
  it("honors the account guard and test limit before sending", async () => {
    m.auth.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await send()).status).toBe(403);
    m.limit.mockReturnValue({ ok: false, retryAfterSeconds: 60 });
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(m.send).not.toHaveBeenCalled();
  });
});
