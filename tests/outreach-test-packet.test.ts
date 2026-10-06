import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ one: vi.fn(), gather: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/db", () => ({ queryOne: m.one }));
vi.mock("@/lib/opportunity-attachments", () => ({ gatherTradeAttachments: m.gather }));
vi.mock("@/lib/ai/companyProfile", () => ({ getProfileJson: m.profile }));
import { buildOutreachTest } from "@/lib/outreach-test";
const template = { subject: "Pricing request: {{trade}}", body: "Hi {{owner_name}}, please review {{opportunity_title}}." };
const pair = { opportunityId: "opp", subcontractorId: "sub", trade: "HVAC" };
beforeEach(() => vi.resetAllMocks());

describe("controlled test packet", () => {
  it("clearly labels sample data and never invents attached bid documents", async () => {
    const result = await buildOutreachTest("org", template);
    expect(result.mode).toBe("sample");
    expect(result.subject).toMatch(/^\[TEST\]/);
    expect(result.text).toContain("sample data, with no bid documents attached");
    expect(result.attachments).toEqual([]);
    expect(result.text).not.toContain("Statement of Work.pdf");
    expect(m.gather).not.toHaveBeenCalled();
    expect(m.one).not.toHaveBeenCalled();
  });
  it("refuses a real copy when either record is outside the sending account", async () => {
    m.one.mockResolvedValueOnce({ id: "opp" }).mockResolvedValueOnce(null);
    await expect(buildOutreachTest("org", template, pair)).rejects.toThrow("could not be found on this account");
    expect(m.one).toHaveBeenNthCalledWith(1, expect.stringContaining("org_id=$2"), ["opp", "org"]);
    expect(m.one).toHaveBeenNthCalledWith(2, expect.stringContaining("org_id=$2"), ["sub", "org"]);
    expect(m.gather).not.toHaveBeenCalled();
  });
  it("holds the copy when actual bid links cannot be verified", async () => {
    m.one.mockResolvedValueOnce({ id: "opp", status: "open", is_sources_sought: false })
      .mockResolvedValueOnce({ id: "sub" }).mockResolvedValueOnce({ trade: "HVAC" });
    m.profile.mockResolvedValue({});
    m.gather.mockResolvedValue({ files: [], expected: 1, links: [{ name: "Scope.pdf", url: "https://example.com/scope.pdf", reachable: false }], undelivered: [] });
    await expect(buildOutreachTest("org", template, pair)).rejects.toThrow("actual bid package is not sendable");
    expect(m.gather).toHaveBeenCalledWith("org", expect.anything(), "HVAC");
  });
});

it("does not claim sample delivery includes the default template's bid documents", async () => {
  const result = await buildOutreachTest("org", {
    subject: "Pricing request",
    body: "Please review the complete scope, requirements, and attached bid documents. If your team can perform the complete trade scope, reply with your price.",
  });
  expect(result.text).not.toContain("and attached bid documents");
  expect(result.html).not.toContain("and attached bid documents");
  expect(result.text).toContain("sample scope and requirements");
  expect(result.attachments).toEqual([]);
  expect(m.gather).not.toHaveBeenCalled();
});

it.each([
  [{ id: "opp", status: "open", is_sources_sought: true }, "Sources Sought"],
  [{ id: "opp", status: "archived", is_sources_sought: false }, "closed record"],
])("refuses research or closed records before document gathering", async (opp, message) => {
  m.one.mockResolvedValueOnce(opp).mockResolvedValueOnce({ id: "sub" });
  await expect(buildOutreachTest("org", template, pair)).rejects.toThrow(message);
  expect(m.gather).not.toHaveBeenCalled();
  expect(m.profile).not.toHaveBeenCalled();
});
it("refuses a guessed or removed bid/subcontractor/trade pairing before gathering", async () => {
  m.one.mockResolvedValueOnce({ id: "opp", status: "open" })
    .mockResolvedValueOnce({ id: "sub" }).mockResolvedValueOnce(null);
  await expect(buildOutreachTest("org", template, pair)).rejects.toThrow("no active saved association");
  expect(m.gather).not.toHaveBeenCalled();
  expect(m.profile).not.toHaveBeenCalled();
});
