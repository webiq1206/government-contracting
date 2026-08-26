/**
 * Reading and writing the per-trade pricing rows, and freezing the
 * calculation when a package is approved or sent.
 *
 * Every query here is scoped by org id in its where clause, not by a filter
 * applied afterwards. The opportunity id arrives from a URL, so it is a value
 * an attacker chooses; the org id comes from the session, which is the one
 * thing in the request they do not control.
 */
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import {
  parseConfidence,
  parseCoveredBy,
  tradeScopeKey,
  type Alternate,
  type CostComponent,
  type Exclusion,
  type PricingRow,
  type QuoteCandidate,
  emptyRow,
} from "./domain/pricing-row";
import type { ProposedRow } from "./domain/quote-fields";

const COMPONENTS: CostComponent[] = [
  "baseQuote",
  "taxes",
  "freight",
  "mobilization",
  "bonding",
  "manualAdjustment",
];

interface DbRow {
  id: string;
  scope_key: string;
  trade: string;
  selected_sub_id: string | null;
  selected_sub_name: string | null;
  backup_sub_id: string | null;
  backup_sub_name: string | null;
  base_quote: string | null;
  taxes: string | null;
  freight: string | null;
  mobilization: string | null;
  bonding: string | null;
  manual_adjustment: string | null;
  manual_adjustment_reason: string | null;
  pending_components: string[] | null;
  alternates: unknown;
  exclusions: unknown;
  payment_terms: string | null;
  quote_expires_on: Date | null;
  availability: string | null;
  lead_time_days: number | null;
  confidence: string;
  supporting_document_id: string | null;
  updated_at: Date;
  updated_by: string | null;
}

/**
 * node-postgres hands back `numeric` as a string so it cannot lose precision.
 * Null stays null: this is the one conversion where a `Number(null)` reflex
 * would turn every unknown price in the system into a zero.
 */
function money(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `date` columns arrive as Date. The domain works in yyyy-mm-dd. */
function isoDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function parseAlternates(v: unknown): Alternate[] {
  if (!Array.isArray(v)) return [];
  const out: Alternate[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    if (!label) continue;
    const amount = typeof o.amount === "number" && Number.isFinite(o.amount) ? o.amount : null;
    out.push({ label, amount, included: o.included === true });
  }
  return out;
}

function parseExclusions(v: unknown): Exclusion[] {
  if (!Array.isArray(v)) return [];
  const out: Exclusion[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    out.push({
      // Fails closed: an exclusion whose coverage nobody recorded is
      // unassigned, which blocks, rather than covered, which does not.
      coveredBy: parseCoveredBy(o.covered_by ?? o.coveredBy),
      text,
      note: typeof o.note === "string" && o.note.trim() ? o.note.trim() : null,
    });
  }
  return out;
}

function parsePending(v: string[] | null): CostComponent[] {
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is CostComponent => (COMPONENTS as string[]).includes(c));
}

function toRow(r: DbRow): PricingRow {
  return {
    id: r.id,
    scopeKey: r.scope_key,
    trade: r.trade,
    selectedSubId: r.selected_sub_id,
    selectedSubName: r.selected_sub_name,
    backupSubId: r.backup_sub_id,
    backupSubName: r.backup_sub_name,
    baseQuote: money(r.base_quote),
    taxes: money(r.taxes),
    freight: money(r.freight),
    mobilization: money(r.mobilization),
    bonding: money(r.bonding),
    manualAdjustment: money(r.manual_adjustment),
    manualAdjustmentReason: r.manual_adjustment_reason,
    pendingComponents: parsePending(r.pending_components),
    alternates: parseAlternates(r.alternates),
    exclusions: parseExclusions(r.exclusions),
    paymentTerms: r.payment_terms,
    quoteExpiresOn: isoDate(r.quote_expires_on),
    availability: r.availability,
    leadTimeDays: r.lead_time_days,
    confidence: parseConfidence(r.confidence),
    supportingDocumentId: r.supporting_document_id,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

const SELECT = `
  select p.id, p.scope_key, p.trade,
         p.selected_sub_id, sel.company_name as selected_sub_name,
         p.backup_sub_id, bak.company_name as backup_sub_name,
         p.base_quote, p.taxes, p.freight, p.mobilization, p.bonding,
         p.manual_adjustment, p.manual_adjustment_reason, p.pending_components,
         p.alternates, p.exclusions, p.payment_terms, p.quote_expires_on,
         p.availability, p.lead_time_days, p.confidence,
         p.supporting_document_id, p.updated_at, p.updated_by
    from trade_pricing_rows p
    left join subcontractors sel on sel.id = p.selected_sub_id
    left join subcontractors bak on bak.id = p.backup_sub_id
`;

export async function pricingRowsFor(opportunityId: string, orgId: string): Promise<PricingRow[]> {
  const rows = await query<DbRow>(
    `${SELECT} where p.opportunity_id = $1 and p.org_id = $2 order by p.trade`,
    [opportunityId, orgId]
  );
  return rows.map(toRow);
}

interface QuoteRow {
  id: string;
  trade: string | null;
  subcontractor_id: string | null;
  company_name: string | null;
  quote_amount: string | null;
  payment_terms: string | null;
  is_out_of_range: boolean | null;
}

/**
 * The pricing rows for an opportunity, with the quote screen folded in.
 *
 * Two tables holding prices is the same mistake as two SSRF guards: whichever
 * one a given screen happens to read becomes the truth for that screen, and
 * the two drift. So there is one model. Stored rows are authoritative; a trade
 * priced only through the older quote form is projected into a row here,
 * marked `derived`, and carries only what a quote actually knows.
 *
 * Where several firms have quoted one trade and no row selects among them, the
 * projected row has no base quote. Taking the lowest would be the product
 * making a decision it has no basis for: the cheapest quote is regularly the
 * one that excluded the most work.
 */
export async function pricingRowsWithQuotes(
  opportunityId: string,
  orgId: string
): Promise<PricingRow[]> {
  const [stored, quotes] = await Promise.all([
    pricingRowsFor(opportunityId, orgId),
    query<QuoteRow>(
      `select q.id, q.trade, q.subcontractor_id, s.company_name,
              q.quote_amount, q.payment_terms, q.is_out_of_range
         from quotes q
         left join subcontractors s on s.id = q.subcontractor_id
        where q.opportunity_id = $1
          and exists (select 1 from opportunities o
                       where o.id = q.opportunity_id and o.org_id = $2)
        order by q.created_at`,
      [opportunityId, orgId]
    ),
  ]);

  const byTrade = new Map<string, QuoteCandidate[]>();
  for (const q of quotes) {
    const amount = money(q.quote_amount);
    if (amount == null || amount <= 0) continue;
    const key = tradeScopeKey(q.trade ?? "General");
    if (!key) continue;
    const list = byTrade.get(key) ?? [];
    list.push({
      quoteId: q.id,
      subId: q.subcontractor_id,
      subName: q.company_name,
      amount,
      paymentTerms: q.payment_terms,
      outOfRange: q.is_out_of_range === true,
    });
    byTrade.set(key, list);
  }

  const out: PricingRow[] = stored.map((row) => ({
    ...row,
    candidates: byTrade.get(row.scopeKey) ?? [],
  }));
  const have = new Set(stored.map((r) => r.scopeKey));

  for (const [key, candidates] of byTrade) {
    if (have.has(key)) continue;
    const original = quotes.find((q) => tradeScopeKey(q.trade ?? "General") === key);
    const only = candidates.length === 1 ? candidates[0] : null;
    out.push({
      ...emptyRow(original?.trade?.trim() || "General"),
      scopeKey: key,
      derived: true,
      candidates,
      baseQuote: only ? only.amount : null,
      selectedSubId: only ? only.subId : null,
      selectedSubName: only ? only.subName : null,
      paymentTerms: only ? only.paymentTerms : null,
    });
  }

  return out.sort((a, b) => a.trade.localeCompare(b.trade));
}

export interface SaveRowInput {
  orgId: string;
  opportunityId: string;
  trade: string;
  selectedSubId?: string | null;
  backupSubId?: string | null;
  baseQuote?: number | null;
  taxes?: number | null;
  freight?: number | null;
  mobilization?: number | null;
  bonding?: number | null;
  manualAdjustment?: number | null;
  manualAdjustmentReason?: string | null;
  pendingComponents?: string[];
  alternates?: unknown;
  exclusions?: unknown;
  paymentTerms?: string | null;
  quoteExpiresOn?: string | null;
  availability?: string | null;
  leadTimeDays?: number | null;
  confidence?: string;
  supportingDocumentId?: string | null;
  actor: string;
}

export class PricingRowRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PricingRowRejected";
  }
}

/**
 * Write one trade's row, replacing whatever was there.
 *
 * Upsert on (opportunity, scope key) rather than on the row id, because the
 * identity of a pricing row is the work it prices. Two operators opening the
 * electrical row in two tabs must not produce two electrical rows.
 *
 * Every referenced id is checked against the caller's own org before it is
 * stored. A subcontractor id and a document id both arrive in the request
 * body, and both are joined and rendered afterwards.
 */
export async function savePricingRow(input: SaveRowInput): Promise<PricingRow> {
  const trade = input.trade.trim();
  if (!trade) throw new PricingRowRejected("A pricing row must name the trade it prices.");
  const scopeKey = tradeScopeKey(trade);
  if (!scopeKey) {
    throw new PricingRowRejected("That trade name has no letters or numbers in it.");
  }

  for (const [field, value] of [
    ["base quote", input.baseQuote],
    ["taxes", input.taxes],
    ["freight", input.freight],
    ["mobilisation", input.mobilization],
    ["bonding", input.bonding],
  ] as const) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new PricingRowRejected(`The ${field} figure must be zero or more.`);
    }
    // All money in this system is whole US dollars, never cents.
    if (value > 100_000_000) {
      throw new PricingRowRejected(`The ${field} figure is over $100M. Enter dollars, not cents.`);
    }
  }
  if (input.manualAdjustment != null) {
    if (!Number.isFinite(input.manualAdjustment)) {
      throw new PricingRowRejected("The manual adjustment must be a number.");
    }
    if (Math.abs(input.manualAdjustment) > 100_000_000) {
      throw new PricingRowRejected("The manual adjustment is over $100M. Enter dollars, not cents.");
    }
    // Mirrors the check constraint so the operator gets a sentence rather than
    // a database error, and so the constraint stays the thing that is true.
    if (
      input.manualAdjustment !== 0 &&
      (input.manualAdjustmentReason ?? "").trim().length < 20
    ) {
      throw new PricingRowRejected(
        "Say why the price was adjusted, in a sentence. It is the only record of the reason later."
      );
    }
  }
  if (input.leadTimeDays != null && (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0)) {
    throw new PricingRowRejected("Lead time is a number of days, zero or more.");
  }
  if (input.quoteExpiresOn != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.quoteExpiresOn)) {
    throw new PricingRowRejected("The quote expiry must be a date.");
  }

  const selectedSubId = await ownSub(input.selectedSubId, input.orgId, "selected");
  const backupSubId = await ownSub(input.backupSubId, input.orgId, "backup");
  if (selectedSubId != null && backupSubId != null && selectedSubId === backupSubId) {
    throw new PricingRowRejected("The backup subcontractor cannot be the selected one.");
  }
  const documentId = await ownDocument(input.supportingDocumentId, input.orgId);

  const alternates = parseAlternates(input.alternates);
  const exclusions = parseExclusions(input.exclusions);
  const pending = parsePending((input.pendingComponents ?? []) as string[]);

  const row = await queryOne<DbRow>(
    `insert into trade_pricing_rows
       (org_id, opportunity_id, scope_key, trade, selected_sub_id, backup_sub_id,
        base_quote, taxes, freight, mobilization, bonding,
        manual_adjustment, manual_adjustment_reason, pending_components,
        alternates, exclusions, payment_terms, quote_expires_on, availability,
        lead_time_days, confidence, supporting_document_id, updated_by)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,
            $17,$18,$19,$20,$21,$22,$23
      where exists (select 1 from opportunities where id = $2 and org_id = $1)
     on conflict (opportunity_id, scope_key) do update set
        trade = excluded.trade,
        selected_sub_id = excluded.selected_sub_id,
        backup_sub_id = excluded.backup_sub_id,
        base_quote = excluded.base_quote,
        taxes = excluded.taxes,
        freight = excluded.freight,
        mobilization = excluded.mobilization,
        bonding = excluded.bonding,
        manual_adjustment = excluded.manual_adjustment,
        manual_adjustment_reason = excluded.manual_adjustment_reason,
        pending_components = excluded.pending_components,
        alternates = excluded.alternates,
        exclusions = excluded.exclusions,
        payment_terms = excluded.payment_terms,
        quote_expires_on = excluded.quote_expires_on,
        availability = excluded.availability,
        lead_time_days = excluded.lead_time_days,
        confidence = excluded.confidence,
        supporting_document_id = excluded.supporting_document_id,
        updated_by = excluded.updated_by,
        updated_at = now()
     returning id`,
    [
      input.orgId,
      input.opportunityId,
      scopeKey,
      trade,
      selectedSubId,
      backupSubId,
      input.baseQuote ?? null,
      input.taxes ?? null,
      input.freight ?? null,
      input.mobilization ?? null,
      input.bonding ?? null,
      input.manualAdjustment ?? null,
      input.manualAdjustmentReason?.trim() || null,
      pending,
      JSON.stringify(alternates),
      JSON.stringify(exclusions),
      input.paymentTerms?.trim() || null,
      input.quoteExpiresOn ?? null,
      input.availability?.trim() || null,
      input.leadTimeDays ?? null,
      parseConfidence(input.confidence),
      documentId,
      input.actor,
    ]
  );
  // The insert is guarded by `where exists`, so no row back means the
  // opportunity is not this org's. Same answer as a missing one, deliberately:
  // a different message would confirm the record exists.
  if (!row) throw new PricingRowRejected("That opportunity is not on this account.");

  const saved = await queryOne<DbRow>(`${SELECT} where p.id = $1`, [row.id]);
  if (!saved) throw new PricingRowRejected("The row was saved but could not be read back.");
  return toRow(saved);
}

export async function deletePricingRow(
  opportunityId: string,
  orgId: string,
  scopeKey: string
): Promise<boolean> {
  const gone = await query<{ id: string }>(
    `delete from trade_pricing_rows
      where opportunity_id = $1 and org_id = $2 and scope_key = $3
      returning id`,
    [opportunityId, orgId, scopeKey]
  );
  return gone.length > 0;
}

async function ownSub(
  id: string | null | undefined,
  orgId: string,
  which: string
): Promise<string | null> {
  if (!id) return null;
  const owned = await queryOne<{ id: string }>(
    `select id from subcontractors where id = $1 and org_id = $2`,
    [id, orgId]
  ).catch(() => null);
  if (!owned) {
    throw new PricingRowRejected(
      `The ${which} subcontractor is not on your roster. Pick one from the list.`
    );
  }
  return owned.id;
}

async function ownDocument(id: string | null | undefined, orgId: string): Promise<string | null> {
  if (!id) return null;
  const owned = await queryOne<{ id: string }>(
    `select id from documents where id = $1 and org_id = $2`,
    [id, orgId]
  ).catch(() => null);
  if (!owned) throw new PricingRowRejected("That supporting file is not on this account.");
  return owned.id;
}

// ---------------------------------------------------------------------------
// Frozen calculations
// ---------------------------------------------------------------------------

export interface CalculationSnapshot {
  id: string;
  reason: "approved" | "sent";
  takenAt: Date;
  actor: string;
  calculation: Record<string, unknown>;
  calculationHash: string;
}

/**
 * A stable hash of the calculation.
 *
 * Object key order is normalised first, because `JSON.stringify` preserves
 * insertion order and two runs that produced identical arithmetic would
 * otherwise hash differently depending on which fields happened to be set.
 */
export function calculationHash(calculation: unknown): string {
  return createHash("sha256").update(canonical(calculation)).digest("hex");
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(",")}}`;
}

/**
 * Freeze the calculation behind a decision.
 *
 * Returns the existing snapshot when one with the same reason and the same
 * hash is already on file, so a retried approval does not stack duplicates.
 * A snapshot with the same reason and a *different* hash is written as a new
 * row: the numbers moved between two approvals, and that is exactly the
 * history this table exists to keep.
 */
export async function freezeCalculation(input: {
  bidId: string;
  orgId: string;
  opportunityId: string;
  reason: "approved" | "sent";
  actor: string;
  calculation: Record<string, unknown>;
}): Promise<CalculationSnapshot> {
  const hash = calculationHash(input.calculation);
  const existing = await queryOne<{
    id: string;
    reason: string;
    taken_at: Date;
    actor: string;
    calculation: Record<string, unknown>;
    calculation_hash: string;
  }>(
    `select id, reason, taken_at, actor, calculation, calculation_hash
       from bid_calculation_snapshots
      where bid_id = $1 and org_id = $2 and reason = $3 and calculation_hash = $4
      order by taken_at desc limit 1`,
    [input.bidId, input.orgId, input.reason, hash]
  );
  if (existing) {
    return {
      id: existing.id,
      reason: existing.reason as "approved" | "sent",
      takenAt: existing.taken_at,
      actor: existing.actor,
      calculation: existing.calculation,
      calculationHash: existing.calculation_hash,
    };
  }

  const row = await queryOne<{ id: string; taken_at: Date }>(
    `insert into bid_calculation_snapshots
       (bid_id, org_id, opportunity_id, reason, actor, calculation, calculation_hash)
     select $1,$2,$3,$4,$5,$6::jsonb,$7
      where exists (select 1 from bids where id = $1 and org_id = $2)
     returning id, taken_at`,
    [
      input.bidId,
      input.orgId,
      input.opportunityId,
      input.reason,
      input.actor,
      JSON.stringify(input.calculation),
      hash,
    ]
  );
  if (!row) throw new PricingRowRejected("That bid is not on this account.");
  return {
    id: row.id,
    reason: input.reason,
    takenAt: row.taken_at,
    actor: input.actor,
    calculation: input.calculation,
    calculationHash: hash,
  };
}

export async function snapshotsFor(bidId: string, orgId: string): Promise<CalculationSnapshot[]> {
  const rows = await query<{
    id: string;
    reason: string;
    taken_at: Date;
    actor: string;
    calculation: Record<string, unknown>;
    calculation_hash: string;
  }>(
    `select id, reason, taken_at, actor, calculation, calculation_hash
       from bid_calculation_snapshots
      where bid_id = $1 and org_id = $2
      order by taken_at desc`,
    [bidId, orgId]
  );
  return rows.map((r) => ({
    id: r.id,
    reason: r.reason as "approved" | "sent",
    takenAt: r.taken_at,
    actor: r.actor,
    calculation: r.calculation,
    calculationHash: r.calculation_hash,
  }));
}

// ---------------------------------------------------------------------------
// Rows proposed by an automatic reading
// ---------------------------------------------------------------------------

/**
 * Write a row the reply extractor proposed.
 *
 * `onlyIfAbsent` is the whole safety of this path. An automatic read of an
 * email may fill a trade nobody has priced; it may never change one somebody
 * typed. A person who entered 104,000 after a phone call and then received an
 * email saying 98,000 has a decision to make, and the product taking it
 * silently is the failure mode.
 *
 * Every field is written as proposed, including `unknown` confidence and an
 * unassigned exclusion. Nothing is upgraded on the way in: the row says what
 * the reply said, and the gaps stay gaps.
 */
export async function saveProposedRow(input: {
  orgId: string;
  opportunityId: string;
  subcontractorId: string | null;
  sourceQuoteId?: string | null;
  proposal: ProposedRow;
  onlyIfAbsent: boolean;
}): Promise<"written" | "kept_existing"> {
  const p = input.proposal;
  const conflict = input.onlyIfAbsent
    ? "do nothing"
    : `do update set
         base_quote = excluded.base_quote,
         taxes = excluded.taxes,
         freight = excluded.freight,
         mobilization = excluded.mobilization,
         bonding = excluded.bonding,
         pending_components = excluded.pending_components,
         alternates = excluded.alternates,
         exclusions = excluded.exclusions,
         payment_terms = excluded.payment_terms,
         quote_expires_on = excluded.quote_expires_on,
         availability = excluded.availability,
         lead_time_days = excluded.lead_time_days,
         confidence = excluded.confidence,
         updated_at = now()`;

  const row = await queryOne<{ id: string }>(
    `insert into trade_pricing_rows
       (org_id, opportunity_id, scope_key, trade, selected_sub_id,
        base_quote, taxes, freight, mobilization, bonding, pending_components,
        alternates, exclusions, payment_terms, quote_expires_on, availability,
        lead_time_days, confidence, source_quote_id, updated_by)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,
            'reply-capture'
      where exists (select 1 from opportunities where id = $2 and org_id = $1)
     on conflict (opportunity_id, scope_key) ${conflict}
     returning id`,
    [
      input.orgId,
      input.opportunityId,
      p.scopeKey,
      p.trade,
      input.subcontractorId,
      p.baseQuote,
      p.taxes,
      p.freight,
      p.mobilization,
      p.bonding,
      p.pendingComponents,
      JSON.stringify(p.alternates),
      JSON.stringify(
        p.exclusions.map((e) => ({ text: e.text, covered_by: e.coveredBy, note: e.note ?? null }))
      ),
      p.paymentTerms,
      p.quoteExpiresOn,
      p.availability,
      p.leadTimeDays,
      p.confidence,
      input.sourceQuoteId ?? null,
    ]
  );
  return row ? "written" : "kept_existing";
}
