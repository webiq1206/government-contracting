/**
 * Unit tests for ingestOpportunity dedupe behavior with a mocked DB.
 * Proves: second insert with same source_id or same open solicitation number
 * never creates another row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn(async () => []);
const queryOne = vi.fn(async () => null);

vi.mock("../lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
}));

import { ingestOpportunity } from "../lib/domain/opportunity-ingest";

const stored = (over: Record<string, unknown> = {}) => ({
  source_id: "notice-1",
  solicitation_number: "SOL-1",
  title: "Job",
  description: null,
  naics_code: null,
  psc_code: null,
  set_aside_type: null,
  value_estimated: null,
  value_estimated_source: null,
  deadline: null,
  posted_at: null,
  location_state: null,
  location_text: null,
  agency: null,
  sub_agency: null,
  contact_json: null,
  attachments_json: [],
  raw_json: null,
  risk_flags: [],
  ...over,
});

describe("ingestOpportunity (mocked db)", () => {
  beforeEach(() => {
    query.mockReset();
    queryOne.mockReset();
    query.mockResolvedValue([]);
  });

  it("skips insert when source_id already exists", async () => {
    queryOne
      .mockResolvedValueOnce({ id: "existing-1" }) // by source_id
      .mockResolvedValueOnce(stored()); // refresh snapshot
    query.mockResolvedValueOnce([]); // refresh

    const res = await ingestOpportunity({
      orgId: "org-1",
      source: "sam_federal",
      source_id: "notice-1",
      solicitation_number: "SOL-1",
      title: "Job",
    });

    expect(res.inserted).toBe(false);
    expect(res.id).toBe("existing-1");
    expect(res.dedupedBy).toBe("source_id");
    expect(res.materialChanged).toBe(false);
    // No INSERT statement
    expect(
      queryOne.mock.calls.some((c) => String(c[0]).includes("insert into opportunities"))
    ).toBe(false);
  });

  it("skips insert when open solicitation_number already exists", async () => {
    queryOne
      .mockResolvedValueOnce(null) // by source_id
      .mockResolvedValueOnce({ id: "existing-sol" }) // by sol number
      .mockResolvedValueOnce(stored({ source_id: "notice-old", title: "Amendment" }));
    query.mockResolvedValueOnce([]); // refresh

    const res = await ingestOpportunity({
      orgId: "org-1",
      source: "sam_federal",
      source_id: "notice-2",
      solicitation_number: "SOL-1",
      title: "Amendment",
    });

    expect(res.inserted).toBe(false);
    expect(res.id).toBe("existing-sol");
    expect(res.dedupedBy).toBe("solicitation_number");
  });

  it("inserts when no match", async () => {
    queryOne
      .mockResolvedValueOnce(null) // source_id
      .mockResolvedValueOnce(null) // sol number
      .mockResolvedValueOnce({ id: "new-1" }); // insert returning

    const res = await ingestOpportunity({
      orgId: "org-1",
      source: "sam_federal",
      source_id: "notice-3",
      solicitation_number: "SOL-3",
      title: "Fresh",
      attachments_json: [],
      raw_json: {},
    });

    expect(res.inserted).toBe(true);
    expect(res.id).toBe("new-1");
    expect(
      queryOne.mock.calls.some((c) => String(c[0]).includes("insert into opportunities"))
    ).toBe(true);
  });

  it("resolves unique_violation races to the existing row", async () => {
    const uniqueErr = Object.assign(new Error("duplicate key"), { code: "23505" });
    queryOne
      .mockResolvedValueOnce(null) // source lookup
      .mockResolvedValueOnce(null) // sol lookup
      .mockRejectedValueOnce(uniqueErr) // insert
      .mockResolvedValueOnce({ id: "raced-1" }) // re-find by source
      .mockResolvedValueOnce(
        stored({
          source_id: "notice-race",
          solicitation_number: "SOL-RACE",
          title: "Race",
        })
      );
    query.mockResolvedValue([]);

    const res = await ingestOpportunity({
      orgId: "org-1",
      source: "sam_federal",
      source_id: "notice-race",
      solicitation_number: "SOL-RACE",
      title: "Race",
      attachments_json: [],
      raw_json: {},
    });

    expect(res.inserted).toBe(false);
    expect(res.id).toBe("raced-1");
    expect(res.dedupedBy).toBe("source_id");
  });

  it("reports a material refresh and merges a new amendment link", async () => {
    queryOne
      .mockResolvedValueOnce({ id: "existing-1" })
      .mockResolvedValueOnce(
        stored({
          description: "Original scope",
          attachments_json: [
            { name: "attachment", url: "https://api.sam.gov/file?id=base&api_key=old" },
          ],
        })
      );

    const res = await ingestOpportunity({
      orgId: "org-1",
      source: "sam_federal",
      source_id: "notice-1",
      solicitation_number: "SOL-1",
      title: "Job",
      description: "Scope changed by Amendment 1",
      attachments_json: [
        { name: "attachment", url: "https://api.sam.gov/file?id=amendment&api_key=fresh" },
      ],
    });

    expect(res.refreshed).toBe(true);
    expect(res.materialChanged).toBe(true);
    expect(res.materialFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const update = query.mock.calls.find((call) =>
      String(call[0]).includes("update opportunities set")
    );
    expect(update).toBeTruthy();
    const params = update?.[1] as unknown[];
    expect(JSON.parse(String(params[17]))).toHaveLength(2);
    expect(params[19]).toContain("awaiting_document_analysis");
    expect(params[20]).toBe(true);
    expect(String(update?.[0])).toContain("analysis_input_hash=case when");
  });

  it("refuses ingest without a source_id", async () => {
    const res = await ingestOpportunity({
      orgId: "org-1",
      source: "sam_federal",
      source_id: "   ",
      title: "No id",
    });
    expect(res.inserted).toBe(false);
    expect(res.id).toBeNull();
    expect(queryOne).not.toHaveBeenCalled();
  });
});
