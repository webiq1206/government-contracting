/**
 * The packet one subcontractor actually receives: selected for their trade,
 * renamed for a human, everything left out accounted for.
 *
 * This drives the real gatherer against real document rows, with only the
 * blob store faked, because the failure it guards against lives in the seams:
 * a filter that quietly eats the wage determination, a renamer that lets
 * "Attachment_2._Wage_Determination.pdf" through to a recipient, an omission
 * nobody can see in any log.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n");

vi.mock("../lib/integrations/storage", () => ({
  storage: {
    download: async (path: string) => {
      if (path.includes("missing")) throw new Error("gone");
      return PDF;
    },
  },
}));

d("gatherTradeAttachments (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let gatherTradeAttachments: typeof import("../lib/opportunity-attachments").gatherTradeAttachments;
  const org = { id: "" };
  const opp = { id: "", title: "Dyess AFB Facility Repairs", solicitation_number: "FA466126Q0027" };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ gatherTradeAttachments } = await import("../lib/opportunity-attachments"));

    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`packet-${randomUUID()}`]
    );
    org.id = o!.id;
    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, solicitation_number)
       values ($1,'test',$2,'sub_research','open',$3) returning id`,
      [org.id, opp.title, opp.solicitation_number]
    );
    opp.id = op!.id;

    const docs: [string, string | null][] = [
      ["FA466126Q0027P00001_-_Amendment_1.pdf", null],
      ["Attachment_2._Wage_Determination.pdf", null],
      ["Attachment_6._Dyess_AFB_Vindicator_IDIQ_SOW_CAO_17_Jul_2026.pdf", null],
      ["Attachment_1._RFO_Provisions_and_Clauses.pdf", null],
      ["Electrical_One-Line_Drawings.pdf", "drawing"],
      ["HVAC_Equipment_Schedule.pdf", null],
    ];
    for (const [name, cls] of docs) {
      await query(
        `insert into documents (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime, document_class)
         values ($1,$2,'solicitation',$3,$4,'local','application/pdf',$5)`,
        [org.id, opp.id, name, `docs/${randomUUID()}.pdf`, cls]
      );
    }
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from documents where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from opportunities where org_id=$1`, [org.id]).catch(() => {});
    await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    vi.restoreAllMocks();
  });

  it("sends the HVAC sub a renamed packet without the electrician's drawings or the prime's paperwork", async () => {
    const gathered = await gatherTradeAttachments(
      { id: opp.id, title: opp.title, solicitation_number: opp.solicitation_number },
      "HVAC"
    );

    const names = gathered.files.map((f) => f.filename).sort();
    expect(names).toEqual(
      [
        "Amendment 1.pdf",
        "Wage Determination.pdf",
        "Dyess AFB Vindicator IDIQ Statement of Work CAO 17 Jul 2026.pdf",
        "HVAC Equipment Schedule.pdf",
      ].sort()
    );
    // Nothing the recipient sees looks system-generated.
    for (const f of gathered.files) {
      expect(f.filename).not.toMatch(/attachment_|_-_|__/i);
      expect(f.mime).toBe("application/pdf");
    }

    // Both omissions are on the record, each with a reason.
    expect(gathered.omitted).toHaveLength(2);
    const reasons = gathered.omitted.map((o) => `${o.name}: ${o.reason}`).join("\n");
    expect(reasons).toMatch(/Electrical_One-Line_Drawings.*electrical work, not HVAC/s);
    expect(reasons).toMatch(/RFO_Provisions_and_Clauses.*prime contractor/s);

    expect(gathered.expected).toBe(true);
    expect(gathered.undelivered).toEqual([]);
  });

  it("gives the electrician their drawings and leaves the HVAC schedule out", async () => {
    const gathered = await gatherTradeAttachments(
      { id: opp.id, title: opp.title, solicitation_number: opp.solicitation_number },
      "Electrical"
    );
    const names = gathered.files.map((f) => f.filename);
    expect(names).toContain("Electrical One-Line Drawings.pdf");
    expect(names).not.toContain("HVAC Equipment Schedule.pdf");
    expect(gathered.omitted.map((o) => o.name)).toContain("HVAC_Equipment_Schedule.pdf");
  });
});
