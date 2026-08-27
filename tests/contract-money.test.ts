import { describe, expect, it } from "vitest";
import {
  MARGIN_CONCERN_TEXT,
  MISSING_LABEL,
  contractMoney,
  marginConcern,
} from "@/lib/domain/contract-money";

const $ = (dollars: number) => dollars * 100;

describe("what it cannot answer, it does not answer", () => {
  /*
   * The rule the whole module turns on. A contract whose subcontractor quotes
   * nobody entered does not have a profit of the full award, and a margin of
   * 100% on a job that has not been priced is the most dangerous number this
   * page could print.
   */
  it("returns null profit rather than the whole award when the costs are unknown", () => {
    const m = contractMoney({ awardCents: $(400_000) });
    expect(m.currentValueCents).toBe($(400_000));
    expect(m.expectedProfitCents).toBeNull();
    expect(m.expectedMarginPct).toBeNull();
  });

  it("names the facts it needed and did not have", () => {
    const m = contractMoney({ awardCents: $(400_000) });
    expect(m.missing).toEqual(["sub_quotes", "invoices", "payments"]);
    for (const f of m.missing) expect(MISSING_LABEL[f]).toBeTruthy();
  });

  it("has nothing missing once every number is recorded", () => {
    const m = contractMoney({
      awardCents: $(400_000), subQuoteCents: $(300_000),
      invoicedCents: $(100_000), paidCents: $(80_000),
    });
    expect(m.missing).toEqual([]);
  });

  it("treats zero as an answer, because somebody stated it", () => {
    // Zero invoiced is a fact about a contract that has not billed yet.
    const m = contractMoney({
      awardCents: $(400_000), subQuoteCents: $(300_000),
      invoicedCents: 0, paidCents: 0,
    });
    expect(m.missing).toEqual([]);
    expect(m.remainingToInvoiceCents).toBe($(400_000));
    expect(m.outstandingCents).toBe(0);
  });
});

describe("the arithmetic", () => {
  it("works profit and margin from the award and the quotes", () => {
    const m = contractMoney({ awardCents: $(400_000), subQuoteCents: $(300_000) });
    expect(m.expectedProfitCents).toBe($(100_000));
    expect(m.expectedMarginPct).toBeCloseTo(25);
  });

  it("carries a deductive modification downward", () => {
    /*
     * Signed, deliberately. Storing a change order unsigned is how a
     * contract's value drifts upward every time somebody takes work away.
     */
    const m = contractMoney({
      awardCents: $(400_000), subQuoteCents: $(300_000), modificationCents: $(-50_000),
    });
    expect(m.currentValueCents).toBe($(350_000));
    expect(m.expectedProfitCents).toBe($(50_000));
  });

  it("measures what is left to invoice against the modified value, not the award", () => {
    const m = contractMoney({
      awardCents: $(400_000), modificationCents: $(60_000), invoicedCents: $(200_000),
    });
    expect(m.remainingToInvoiceCents).toBe($(260_000));
  });

  it("separates invoiced from paid", () => {
    const m = contractMoney({ invoicedCents: $(200_000), paidCents: $(150_000) });
    expect(m.outstandingCents).toBe($(50_000));
  });

  it("works retainage off the current value", () => {
    const m = contractMoney({
      awardCents: $(400_000), modificationCents: $(100_000), retainagePct: 10,
    });
    expect(m.retainageCents).toBe($(50_000));
  });

  it("gives no retainage figure when no rate is recorded", () => {
    expect(contractMoney({ awardCents: $(400_000) }).retainageCents).toBeNull();
  });

  it("refuses to divide by a zero value rather than printing an infinite margin", () => {
    // A contract recorded at zero is a data-entry mistake, and an infinite
    // margin printed next to it helps nobody.
    const m = contractMoney({ awardCents: 0, subQuoteCents: $(10_000) });
    expect(m.expectedProfitCents).toBe($(-10_000));
    expect(m.expectedMarginPct).toBeNull();
  });

  it("reports a real loss rather than clamping it", () => {
    const m = contractMoney({ awardCents: $(100_000), subQuoteCents: $(120_000) });
    expect(m.expectedProfitCents).toBe($(-20_000));
    expect(m.expectedMarginPct).toBeCloseTo(-20);
  });
});

describe("whether a margin is worth flagging", () => {
  it("does not treat an unmeasured job as a healthy one", () => {
    expect(marginConcern(null, 15)).toBe("unknown");
    expect(MARGIN_CONCERN_TEXT.unknown).toMatch(/Not enough recorded/);
  });

  it("calls a loss a loss", () => {
    expect(marginConcern(-4, 15)).toBe("negative");
    expect(MARGIN_CONCERN_TEXT.negative).toMatch(/lose money/);
  });

  it("compares against the target when there is one, and not when there is not", () => {
    expect(marginConcern(9, 15)).toBe("below_target");
    expect(marginConcern(9, null)).toBe("fine");
    expect(marginConcern(20, 15)).toBe("fine");
    expect(MARGIN_CONCERN_TEXT.fine).toBeNull();
  });
});
