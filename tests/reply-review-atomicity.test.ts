import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  logAgent: vi.fn(),
  enqueue: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
}));
vi.mock("@/lib/logger", () => ({ logAgent: mocks.logAgent }));
vi.mock("@/lib/queue", () => ({ enqueue: mocks.enqueue }));
vi.mock("@/lib/integrations/email-transport", () => ({
  sendOutreachEmail: mocks.sendEmail,
}));

const proposal = {
  trade: "Electrical",
  scopeKey: "electrical",
  baseQuote: 42_000,
  taxes: null,
  freight: null,
  mobilization: null,
  bonding: null,
  pendingComponents: [],
  paymentTerms: "Net 30",
  quoteExpiresOn: null,
  availability: null,
  leadTimeDays: null,
  confidence: "confirmed" as const,
  exclusions: [],
  alternates: [],
  missing: [],
  notes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockRejectedValue(new Error("global query must not run"));
  mocks.queryOne.mockRejectedValue(new Error("global queryOne must not run"));
  mocks.logAgent.mockRejectedValue(new Error("activity must wait for commit"));
  mocks.enqueue.mockRejectedValue(new Error("automation must wait for commit"));
});

describe("reply review transaction-aware domain writes", () => {
  it("writes outcome and partial-scope flags through the supplied client and defers automation", async () => {
    const clientQuery = vi.fn(async () => ({ rows: [] }));
    const { applyOutcomeToSolicitation } =
      await import("@/lib/domain/reply-outcome");

    const result = await applyOutcomeToSolicitation(
      {
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        trade: "Electrical",
        outcome: "partial_scope",
      },
      { query: clientQuery } as never,
    );

    expect(result).toMatchObject({
      applied: true,
      enqueue: {
        agent: "sub-finder",
        payload: { opportunityId: "opp-1", trade: "Electrical" },
      },
    });
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("writes the structured pricing proposal through the supplied client", async () => {
    const clientQuery = vi.fn(async () => ({ rows: [{ id: "price-1" }] }));
    const { saveProposedRow } = await import("@/lib/pricing-rows");

    const result = await saveProposedRow(
      {
        orgId: "org-1",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        sourceQuoteId: "quote-1",
        proposal,
        onlyIfAbsent: true,
      },
      { query: clientQuery } as never,
    );

    expect(result).toBe("written");
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(String(clientQuery.mock.calls[0]?.[0])).toContain(
      "insert into trade_pricing_rows",
    );
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("distinguishes an existing operator price from a blocked pricing write", async () => {
    const { saveProposedRow } = await import("@/lib/pricing-rows");
    const input = {
      orgId: "org-1",
      opportunityId: "opp-1",
      subcontractorId: "sub-1",
      sourceQuoteId: "quote-1",
      proposal,
      onlyIfAbsent: true,
    };

    const existingClient = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "operator-price-1" }] });
    await expect(
      saveProposedRow(input, { query: existingClient } as never),
    ).resolves.toBe("kept_existing");

    const blockedClient = vi.fn(async () => ({ rows: [] }));
    await expect(
      saveProposedRow(input, { query: blockedClient } as never),
    ).resolves.toBe("not_editable");
    expect(blockedClient).toHaveBeenCalledTimes(2);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("keeps decline state, call-card, and capability-note writes on one client", async () => {
    const clientQuery = vi.fn(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (/select o\.org_id/.test(sql)) return { rows: [{ org_id: "org-1" }] };
      if (/select distinct os\.trade/.test(sql))
        return { rows: [{ trade: "Electrical" }] };
      return { rows: [] };
    });
    const { closeOutDeclinedSub } =
      await import("@/lib/domain/decline-closeout");

    await closeOutDeclinedSub(
      {
        orgId: "org-1",
        opportunityId: "opp-1",
        subcontractorId: "sub-1",
        trade: "Electrical",
        source: "email_reply",
        capabilityNotes: "Cannot staff this work.",
        sendThankYou: false,
      },
      {
        client: { query: clientQuery } as never,
        deferActivityLog: true,
      },
    );

    expect(clientQuery).toHaveBeenCalledTimes(5);
    expect(
      clientQuery.mock.calls.map(([sql]) => String(sql)).join("\n"),
    ).toMatch(
      /update opportunity_subs[\s\S]*update call_cards[\s\S]*update subcontractors/,
    );
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.logAgent).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an external email inside a caller-owned transaction", async () => {
    const { closeOutDeclinedSub } =
      await import("@/lib/domain/decline-closeout");

    await expect(
      closeOutDeclinedSub(
        {
          opportunityId: "opp-1",
          subcontractorId: "sub-1",
          source: "email_reply",
          sendThankYou: true,
        },
        { client: { query: vi.fn() } as never, deferActivityLog: true },
      ),
    ).rejects.toThrow(/Email cannot be sent inside/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("reply review source transaction boundary", () => {
  const path = join(process.cwd(), "app/api/replies/[id]/review/route.ts");
  const source = readFileSync(path, "utf8");

  it("uses the transaction client for every core write and leaves queues and logs after commit", () => {
    const start = source.indexOf("await transaction(async (client)");
    const end = source.indexOf("const followUpWarnings", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const boundary = source.slice(start, end);

    expect(boundary).toContain("await client.query<{ id: string }>(");
    expect(boundary).toMatch(/saveProposedRow\([\s\S]*?,\s*client,?\s*\)/);
    expect(boundary).toMatch(
      /applyOutcomeToSolicitation\([\s\S]*?,\s*client,?\s*\)/,
    );
    expect(boundary).toContain("{ client, deferActivityLog: true }");
    expect(boundary).not.toMatch(/\bawait query(?:One)?\s*(?:<[^>]+>)?\s*\(/);
    expect(boundary).not.toMatch(/\bawait enqueue\s*\(/);
    expect(boundary).not.toMatch(/\bawait logAgent\s*\(/);

    const postCommit = source.slice(end);
    expect(postCommit).toMatch(/await enqueue\s*\(/);
    expect(postCommit).toMatch(/await logAgent\s*\(/);
  });

  it("contains no object literal with the duplicate opportunity id property", () => {
    const syntax = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const duplicates: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const names = node.properties
          .map((property) => property.name)
          .filter((name): name is ts.PropertyName => name !== undefined)
          .map((name) => name.getText(syntax));
        if (names.filter((name) => name === "opportunityId").length > 1) {
          duplicates.push(node.getText(syntax));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
    expect(duplicates).toEqual([]);
  });
});
