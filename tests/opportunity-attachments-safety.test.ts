import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "a66389bf-2db2-4db7-ac72-96398531ad76";
const OPP_ID = "991f1e31-4c12-4a3c-80af-0fb8c8c67784";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n");

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/integrations/storage", () => ({
  storage: { download: mocks.download },
}));

import {
  gatherOpportunityAttachments,
  gatherTradeAttachments,
} from "@/lib/opportunity-attachments";
import { assessAttachmentPackage } from "@/lib/domain/attachment-package";

function doc(index: number) {
  return {
    name: `Statement of Work ${index}.pdf`,
    storage_path: `orgs/${ORG_ID}/documents/sow-${index}.pdf`,
    storage_backend: "db",
    mime: "application/pdf",
    document_class: "statement_of_work",
    amendment_number: null,
    trade_relevance: null,
    relevant_to_all: true,
  };
}

describe("opportunity attachment tenant and completeness safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "attachment-safety-test-secret";
    process.env.APP_URL = "https://brostco.test";
    mocks.download.mockResolvedValue(PDF);
  });

  it("requires an explicit organization before reading documents", async () => {
    await expect(
      gatherOpportunityAttachments("", { id: OPP_ID, title: "Test opportunity" })
    ).rejects.toThrow(/organization is required/i);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("scopes the document read by opportunity and organization", async () => {
    mocks.query.mockResolvedValueOnce([doc(1)]);

    await gatherTradeAttachments(ORG_ID, { id: OPP_ID }, "HVAC");

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where opportunity_id = \$1 and org_id = \$2/i);
    expect(params).toEqual([OPP_ID, ORG_ID]);
  });

  it("loads every document instead of silently dropping everything after row 40", async () => {
    mocks.query.mockResolvedValueOnce(Array.from({ length: 41 }, (_, index) => doc(index + 1)));

    const gathered = await gatherTradeAttachments(ORG_ID, { id: OPP_ID }, "HVAC");

    const [sql] = mocks.query.mock.calls[0] as [string];
    expect(sql).not.toMatch(/\blimit\s+40\b/i);
    expect(gathered.files).toHaveLength(41);
    expect(mocks.download).toHaveBeenCalledTimes(41);
  });

  it("marks an unpreflighted upstream package as blocking", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const gathered = await gatherOpportunityAttachments(ORG_ID, {
      id: OPP_ID,
      title: "Test opportunity",
      attachments_json: [
        {
          name: "Mechanical drawings.pdf",
          url: "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/example",
        },
      ],
    });

    expect(gathered.links).toHaveLength(1);
    expect(gathered.links[0]?.reachable).toBeUndefined();
    const assessment = assessAttachmentPackage(gathered);
    expect(assessment.ok).toBe(false);
    expect(assessment.problems).toContainEqual(
      expect.objectContaining({
        kind: "unreachable_link",
        blocking: true,
        message: expect.stringMatching(/not verified/i),
      })
    );
  });
});
