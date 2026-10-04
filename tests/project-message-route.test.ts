import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), target: vi.fn(), sender: vi.fn(), send: vi.fn() }));
vi.mock("../lib/api-auth", () => ({ requireCapability: m.auth }));
vi.mock("../lib/tenant", () => ({ resolveTenantOrgId: async () => "our-org" }));
vi.mock("../lib/project-message", () => ({ projectMessageTarget: m.target }));
vi.mock("../lib/domain/sender-identity", () => ({ resolveOutreachSender: m.sender }));
vi.mock("../lib/manual-email", () => ({ sendManualEmail: m.send }));
vi.mock("../lib/project-message-refusal", () => ({ refuseProjectMessage: async () => false }));
import { POST } from "../app/api/conversations/compose/route";
const body = { requestKey: "11111111-1111-4111-8111-111111111111", subcontractorId: "22222222-2222-4222-8222-222222222222",
  opportunityId: "33333333-3333-4333-8333-333333333333", trade: "Paint", recipient: "saved@sub.test", sender: "owner@company.test", subject: "Project invitation", message: "Please quote this scope. <b>Plain text</b>" };
const target = { id: body.subcontractorId, email: body.recipient, email_verified: true, pursuit_version: 3, trade: "Paint" };
function request(overrides = {}) { return new Request("http://test/api/conversations/compose", { method: "POST", body: JSON.stringify({ ...body, ...overrides }) }); }
beforeEach(() => {
  vi.clearAllMocks(); m.auth.mockResolvedValue({ id: "operator" }); m.target.mockResolvedValue(target);
  m.sender.mockResolvedValue({ connected: true, from: body.sender }); m.send.mockResolvedValue({ ok: true, threadId: "receipt-thread" });
});
it("uses the tenant's verified project assignment and reviewed sender through durable manual transport", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(m.auth).toHaveBeenCalledWith("outreach");
  expect(m.target).toHaveBeenCalledWith("our-org", body.subcontractorId, body.opportunityId, "Paint");
  const args = m.send.mock.calls[0][0];
  expect(args).toMatchObject({ requestKey: body.requestKey, actorId: "operator", params: { orgId: "our-org", to: body.recipient, subcontractorId: body.subcontractorId, opportunityId: body.opportunityId, trade: "Paint" } });
  expect(args.params.html).toContain("&lt;b&gt;");
  await expect(args.params.beforeProviderSend(body.sender)).resolves.toBeUndefined();
  m.target.mockResolvedValue({ ...target, email: "changed@sub.test" });
  await expect(args.params.beforeProviderSend(body.sender)).rejects.toThrow();
});
it("rejects forged recipients, unverified contacts, changed sender and removed/foreign assignment", async () => {
  expect((await POST(request({ recipient: "forged@sub.test" }))).status).toBe(409);
  expect((await POST(request({ sender: "forged@company.test" }))).status).toBe(409);
  m.target.mockResolvedValue({ ...target, email_verified: false }); expect((await POST(request())).status).toBe(409);
  m.target.mockResolvedValue(null); expect((await POST(request())).status).toBe(404);
  expect(m.send).not.toHaveBeenCalled();
});
it("denies viewers before any target lookup", async () => {
  m.auth.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
  expect((await POST(request())).status).toBe(403); expect(m.target).not.toHaveBeenCalled();
});
it("never declares an older unknown request safe to replace after validation or relationship failure", async () => {
  for (const overrides of [{ subject: "bad\nHeader" }, { recipient: "changed@sub.test" }]) {
    const response = await POST(request(overrides)); expect((await response.json()).safeToCompose).not.toBe(true);
  }
  m.send.mockResolvedValue({ ok: false, status: 503, error: "Uncertain" });
  expect(await (await POST(request())).json()).toEqual({ error: "Uncertain", safeToCompose: false });
  m.send.mockResolvedValue({ ok: false, status: 502, error: "Refused", safeToCompose: true });
  expect((await (await POST(request())).json()).safeToCompose).toBe(true);
});
