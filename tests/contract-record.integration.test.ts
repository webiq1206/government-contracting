/**
 * The contract record, against a real database.
 *
 * Milestones and the coordination log were rendered on the card from jsonb
 * columns nothing ever wrote to, so the two richest fields on a contract were
 * permanently empty in production. Modifications, invoices, payments and
 * issues had no columns at all. These check that what is written comes back,
 * that the money follows the modifications, and that one organization cannot
 * write onto another's contract.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const $ = (dollars: number) => dollars * 100;

d("contract record (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let store: typeof import("../lib/contract-record");

  const mine = { id: "" };
  const theirs = { id: "" };
  let contractId = "";
  let theirContractId = "";

  async function makeContract(orgId: string, award: number | null) {
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, agency, solicitation_number)
       values ($1,'test','Fort Bliss HVAC replacement','awarded','open',
               'US Army Corps of Engineers','W912DR-26-R-0042') returning id`,
      [orgId]
    );
    const bid = await queryOne<{ id: string }>(
      `insert into bids (org_id, opportunity_id, sub_quote_total, bid_amount, target_margin_pct)
       values ($1,$2,$3,$4,15) returning id`,
      [orgId, opp!.id, 300_000, 400_000]
    );
    const c = await queryOne<{ id: string }>(
      `insert into contracts (org_id, opportunity_id, bid_id, contract_number, award_amount, status)
       values ($1,$2,$3,$4,$5,'active') returning id`,
      [orgId, opp!.id, bid!.id, `W912-${randomUUID().slice(0, 6)}`, award]
    );
    return c!.id;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    store = await import("../lib/contract-record");
    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`contract-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    contractId = await makeContract(mine.id, 400_000);
    theirContractId = await makeContract(theirs.id, 100_000);
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      for (const t of [
        "contract_coordination", "contract_issues", "contract_invoices",
        "contract_modifications", "contract_milestones",
      ]) {
        await query(`delete from ${t} where org_id = $1`, [org.id]).catch(() => {});
      }
      await query(`delete from contracts where org_id = $1`, [org.id]).catch(() => {});
      await query(`delete from bids where org_id = $1`, [org.id]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [org.id]).catch(() => {});
      await query(`delete from organizations where id = $1`, [org.id]).catch(() => {});
    }
  });

  it("shows who the work is for, which the record never once said", async () => {
    const rec = await store.contractRecord(mine.id, contractId);
    expect(rec?.header.agency).toBe("US Army Corps of Engineers");
    expect(rec?.header.solicitation_number).toBe("W912DR-26-R-0042");
  });

  it("works profit and margin from the bid rather than storing them", async () => {
    const rec = await store.contractRecord(mine.id, contractId);
    // 400k award less the 300k of subcontractor quotes recorded on the bid.
    expect(rec?.money.expectedProfitCents).toBe($(100_000));
    expect(rec?.money.expectedMarginPct).toBeCloseTo(25);
  });

  it("says what is missing rather than showing a dash", async () => {
    const rec = await store.contractRecord(mine.id, contractId);
    // No invoices yet, and that is different from having invoiced nothing.
    expect(rec?.money.missing).toContain("invoices");
    expect(rec?.money.invoicedCents ?? null).toBeNull();
  });

  describe("milestones and deliverables", () => {
    it("writes, comes back, and completes", async () => {
      const made = await store.saveMilestone({
        orgId: mine.id, contractId, kind: "deliverable",
        name: "Submit the closeout package", dueAt: "2027-01-15", amountCents: $(20_000),
      });
      expect(made.ok).toBe(true);
      if (!made.ok || !made.id) return;

      let rec = await store.contractRecord(mine.id, contractId);
      expect(rec?.milestones).toHaveLength(1);
      expect(rec?.milestones[0].completed_at).toBeNull();

      await store.completeMilestone({
        orgId: mine.id, contractId, milestoneId: made.id, actorId: null,
        evidenceNote: "Emailed to the CO, receipt attached.",
      });
      rec = await store.contractRecord(mine.id, contractId);
      // A date, not a boolean: "when" is the question asked about a delivered
      // milestone.
      expect(rec?.milestones[0].completed_at).toBeTruthy();
      expect(rec?.milestones[0].evidence_note).toMatch(/receipt attached/);

      await store.completeMilestone({
        orgId: mine.id, contractId, milestoneId: made.id, actorId: null, undo: true,
      });
      rec = await store.contractRecord(mine.id, contractId);
      expect(rec?.milestones[0].completed_at).toBeNull();
      // Undoing the completion does not throw away the evidence somebody typed.
      expect(rec?.milestones[0].evidence_note).toMatch(/receipt attached/);
    });

    it("cannot add a milestone to another organization's contract", async () => {
      const res = await store.saveMilestone({
        orgId: mine.id, contractId: theirContractId, kind: "milestone", name: "Intruder",
      });
      expect(res.ok).toBe(false);
      const rec = await store.contractRecord(theirs.id, theirContractId);
      expect(rec?.milestones).toHaveLength(0);
    });
  });

  describe("modifications", () => {
    it("needs a source, so a value change can be checked against paper", async () => {
      const res = await store.saveModification({
        orgId: mine.id, contractId, modNumber: "P00001", kind: "value",
        summary: "Added two rooftop units", valueDeltaCents: $(60_000), actorId: null,
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toMatch(/where this came from/);
    });

    it("needs the amount on a value change", async () => {
      const res = await store.saveModification({
        orgId: mine.id, contractId, modNumber: "P00001", kind: "value",
        summary: "Increased the contract", sourceDocument: "P00001.pdf", actorId: null,
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      // "Mod 3 increased the contract" with no figure is how a contract's
      // worth becomes a thing people argue about from memory.
      expect(res.error).toMatch(/amount it changed by/);
    });

    it("moves the contract value, and takes a deduction downward", async () => {
      await store.saveModification({
        orgId: mine.id, contractId, modNumber: "P00001", kind: "value",
        summary: "Added two rooftop units", valueDeltaCents: $(60_000),
        sourceDocument: "P00001.pdf", actorId: null,
      });
      await store.saveModification({
        orgId: mine.id, contractId, modNumber: "P00002", kind: "value",
        summary: "Removed the east wing scope", valueDeltaCents: $(-25_000),
        sourceDocument: "P00002.pdf", actorId: null,
      });
      const rec = await store.contractRecord(mine.id, contractId);
      expect(rec?.money.currentValueCents).toBe($(435_000));
      // Profit follows the value, so a deduction is not free money.
      expect(rec?.money.expectedProfitCents).toBe($(135_000));
    });

    it("refuses the same modification number twice", async () => {
      const res = await store.saveModification({
        orgId: mine.id, contractId, modNumber: "p00001", kind: "administrative",
        summary: "Duplicate", sourceNote: "Typed twice", actorId: null,
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toMatch(/already recorded/);
    });

    it("does not count a superseded modification toward the value", async () => {
      const before = await store.contractRecord(mine.id, contractId);
      const first = before!.modifications.find((m) => m.mod_number === "P00002")!;
      await store.saveModification({
        orgId: mine.id, contractId, modNumber: "P00003", kind: "value",
        summary: "Corrects P00002, the deduction was 15k not 25k",
        valueDeltaCents: $(-15_000), sourceDocument: "P00003.pdf",
        supersedes: first.id, actorId: null,
      });
      const rec = await store.contractRecord(mine.id, contractId);
      // 400 + 60 - 15, with the superseded -25 excluded. Counting both would
      // double the change, which is the point of keeping the old one visible.
      expect(rec?.money.currentValueCents).toBe($(445_000));
    });

    it("moves the end date with a schedule change rather than in two places", async () => {
      await store.saveModification({
        orgId: mine.id, contractId, modNumber: "P00004", kind: "schedule",
        summary: "Extended for weather", newEndDate: "2027-06-30",
        sourceDocument: "P00004.pdf", actorId: null,
      });
      const rec = await store.contractRecord(mine.id, contractId);
      expect(rec?.header.end_date).toBe("2027-06-30");
    });
  });

  describe("invoices and payments", () => {
    it("records an invoice, then a payment against it", async () => {
      const made = await store.saveInvoice({
        orgId: mine.id, contractId, invoiceNumber: "INV-001", amountCents: $(120_000),
        submittedAt: new Date().toISOString(),
      });
      expect(made.ok).toBe(true);
      if (!made.ok || !made.id) return;

      let rec = await store.contractRecord(mine.id, contractId);
      expect(rec?.money.invoicedCents).toBe($(120_000));
      expect(rec?.money.paidCents).toBe(0);
      expect(rec?.money.outstandingCents).toBe($(120_000));

      await store.settleInvoice({
        orgId: mine.id, contractId, invoiceId: made.id, paidCents: $(108_000),
      });
      rec = await store.contractRecord(mine.id, contractId);
      // Partly paid, because retainage held back 10 percent.
      expect(rec?.money.outstandingCents).toBe($(12_000));
    });

    it("will not let paid and refused stand on the same invoice", async () => {
      const made = await store.saveInvoice({
        orgId: mine.id, contractId, invoiceNumber: "INV-002", amountCents: $(40_000),
      });
      if (!made.ok || !made.id) return;
      await store.settleInvoice({
        orgId: mine.id, contractId, invoiceId: made.id,
        rejectedReason: "Wrong period on the cover sheet",
      });
      let rec = await store.contractRecord(mine.id, contractId);
      let inv = rec!.invoices.find((i) => i.invoice_number === "INV-002")!;
      expect(inv.rejected_reason).toMatch(/cover sheet/);
      expect(inv.paid_at).toBeNull();
      // A refused invoice is not counted as billed.
      expect(rec?.money.invoicedCents).toBe($(120_000));

      await store.settleInvoice({
        orgId: mine.id, contractId, invoiceId: made.id, paidCents: $(40_000),
      });
      rec = await store.contractRecord(mine.id, contractId);
      inv = rec!.invoices.find((i) => i.invoice_number === "INV-002")!;
      // Recording a payment clears the rejection: opposite claims about one
      // invoice cannot both stand.
      expect(inv.rejected_at).toBeNull();
      expect(rec?.money.invoicedCents).toBe($(160_000));
    });

    it("refuses the same invoice number twice on one contract", async () => {
      await expect(
        store.saveInvoice({
          orgId: mine.id, contractId, invoiceNumber: "inv-001", amountCents: $(1),
        })
      ).rejects.toThrow(/already recorded/);
    });
  });

  describe("issues and coordination", () => {
    it("will not close an issue without saying how", async () => {
      const made = await store.saveIssue({
        orgId: mine.id, contractId, title: "Differing site condition in Building 3",
        severity: "serious", actorId: null,
      });
      if (!made.ok || !made.id) return;
      const bad = await store.resolveIssue({
        orgId: mine.id, contractId, issueId: made.id, resolution: "   ",
      });
      expect(bad.ok).toBe(false);

      const good = await store.resolveIssue({
        orgId: mine.id, contractId, issueId: made.id,
        resolution: "Priced as mod P00001 and accepted.",
      });
      expect(good.ok).toBe(true);
      // Closing it twice is a refusal, not a quiet success.
      expect(
        (await store.resolveIssue({
          orgId: mine.id, contractId, issueId: made.id, resolution: "again",
        })).ok
      ).toBe(false);
    });

    it("logs coordination, which is the evidence a set-aside prime has to show", async () => {
      const res = await store.logCoordination({
        orgId: mine.id, contractId, channel: "site_visit",
        withWhom: "Marcus Rivera, Ridgeline Mechanical",
        summary: "Walked Buildings 3 and 4, agreed the crane pick for week two.",
        actorId: null,
      });
      expect(res.ok).toBe(true);
      const rec = await store.contractRecord(mine.id, contractId);
      expect(rec?.coordination).toHaveLength(1);
      expect(rec?.coordination[0].summary).toMatch(/crane pick/);
    });

    it("cannot log coordination onto another organization's contract", async () => {
      const res = await store.logCoordination({
        orgId: mine.id, contractId: theirContractId, channel: "call",
        withWhom: "Someone", summary: "Should never land", actorId: null,
      });
      expect(res.ok).toBe(false);
      const rec = await store.contractRecord(theirs.id, theirContractId);
      expect(rec?.coordination).toHaveLength(0);
    });
  });

  describe("a contract nobody won here", () => {
    it("can be recorded by hand, and says that it was", async () => {
      const res = await store.createContract({
        orgId: mine.id, actorId: null, contractNumber: "LEGACY-001",
        awardAmount: 75_000, startDate: "2026-01-01", endDate: "2026-12-31",
      });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.id) return;
      const rec = await store.contractRecord(mine.id, res.id);
      /*
       * A contract could previously only exist as the output of a win, and
       * the win path hard-refuses an award with no bid record. One signed
       * before this account existed could not be tracked at all.
       */
      expect(rec?.header.created_manually).toBe(true);
      // No bid behind it, so there is no expected profit to claim.
      expect(rec?.money.expectedProfitCents).toBeNull();
      expect(rec?.money.missing).toContain("sub_quotes");
    });

    it("refuses dates that run backwards", async () => {
      const res = await store.createContract({
        orgId: mine.id, actorId: null, contractNumber: "BACKWARDS-1",
        startDate: "2026-12-31", endDate: "2026-01-01",
      });
      expect(res.ok).toBe(false);
    });
  });

  it("returns nothing for a contract in another organization", async () => {
    expect(await store.contractRecord(mine.id, theirContractId)).toBeNull();
  });
});
