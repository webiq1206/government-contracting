import { query, queryOne, transaction } from "@/lib/db";
import { contractMoney, type ContractMoney } from "@/lib/domain/contract-money";

/**
 * Everything on one contract, and the write paths it never had.
 *
 * Milestones and the coordination log were rendered from jsonb columns nothing
 * ever wrote to, so the two richest fields on the record were permanently
 * empty in production. Modifications, invoices, payments and issues had no
 * columns at all.
 *
 * Every statement is org-scoped inside itself, so an id from another tenant is
 * a row that does not match rather than a row somebody else owns. Refusals are
 * returned rather than thrown: a mistyped invoice amount is an ordinary thing
 * for a person to do, and it should come back as a sentence.
 */

export type ContractResult =
  | { ok: true; id?: string }
  | { ok: false; status: number; error: string };

export interface ContractHeader {
  id: string;
  contract_number: string | null;
  status: string;
  award_amount: string | number | null;
  start_date: string | null;
  end_date: string | null;
  non_ss_sub_pct: string | number | null;
  retainage_pct: string | number | null;
  insurance_required: string | null;
  bond_required_cents: string | number | null;
  closeout_started_at: string | null;
  closeout_completed_at: string | null;
  closeout_notes: string | null;
  cpars_due_at: string | null;
  cpars_status: string | null;
  created_manually: boolean;
  opportunity_id: string | null;
  opportunity_title: string | null;
  /** Joined from the opportunity. The record never showed who the work is for. */
  agency: string | null;
  solicitation_number: string | null;
  primary_sub_id: string | null;
  primary_sub_name: string | null;
  backup_sub_id: string | null;
  backup_sub_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  /** From the bid this contract came from, when there was one. */
  sub_quote_total: string | number | null;
  target_margin_pct: string | number | null;
}

export interface ContractMilestone {
  id: string;
  kind: "milestone" | "deliverable";
  name: string;
  detail: string | null;
  due_at: string | null;
  completed_at: string | null;
  amount_cents: string | number | null;
  evidence_note: string | null;
  sort_order: number;
}

export interface ContractModification {
  id: string;
  mod_number: string;
  kind: string;
  summary: string;
  value_delta_cents: string | number | null;
  new_end_date: string | null;
  effective_at: string | null;
  source_document: string | null;
  source_note: string | null;
  superseded_by: string | null;
}

export interface ContractInvoice {
  id: string;
  invoice_number: string;
  amount_cents: string | number;
  period_start: string | null;
  period_end: string | null;
  submitted_at: string | null;
  paid_at: string | null;
  paid_cents: string | number | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  note: string | null;
}

export interface ContractIssue {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  raised_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export interface ContractCoordination {
  id: string;
  happened_at: string;
  channel: string;
  with_whom: string;
  summary: string;
  subcontractor_id: string | null;
}

export interface ContractRecord {
  header: ContractHeader;
  milestones: ContractMilestone[];
  modifications: ContractModification[];
  invoices: ContractInvoice[];
  issues: ContractIssue[];
  coordination: ContractCoordination[];
  money: ContractMoney;
}

const cents = (v: string | number | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** A numeric dollars column as cents. `award_amount` is stored in dollars. */
const dollarsToCents = (v: string | number | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export async function contractRecord(
  orgId: string,
  contractId: string
): Promise<ContractRecord | null> {
  const header = await queryOne<ContractHeader>(
    `select c.id, c.contract_number, c.status,
            c.award_amount, c.start_date::text as start_date, c.end_date::text as end_date,
            c.non_ss_sub_pct, c.retainage_pct, c.insurance_required, c.bond_required_cents,
            c.closeout_started_at::text as closeout_started_at,
            c.closeout_completed_at::text as closeout_completed_at,
            c.closeout_notes, c.cpars_due_at::text as cpars_due_at, c.cpars_status,
            c.created_manually, c.opportunity_id,
            o.title as opportunity_title,
            -- The record showed a title and a number and never once said who
            -- the work is for.
            o.agency, o.solicitation_number,
            c.primary_sub_id, ps.company_name as primary_sub_name,
            c.backup_sub_id, bs.company_name as backup_sub_name,
            c.assigned_to,
            coalesce(nullif(btrim(au.name), ''), split_part(au.email, '@', 1)) as assigned_name,
            b.sub_quote_total, b.target_margin_pct
       from contracts c
       left join opportunities o on o.id = c.opportunity_id
       left join subcontractors ps on ps.id = c.primary_sub_id
       left join subcontractors bs on bs.id = c.backup_sub_id
       left join users au on au.id = c.assigned_to
       left join bids b on b.id = c.bid_id
      where c.id = $1 and c.org_id = $2`,
    [contractId, orgId]
  );
  if (!header) return null;

  const [milestones, modifications, invoices, issues, coordination] = await Promise.all([
    query<ContractMilestone>(
      `select id, kind, name, detail, due_at::text as due_at,
              completed_at::text as completed_at, amount_cents, evidence_note, sort_order
         from contract_milestones
        where contract_id = $1 and org_id = $2
        order by sort_order, (due_at is null), due_at`,
      [contractId, orgId]
    ),
    query<ContractModification>(
      `select id, mod_number, kind, summary, value_delta_cents,
              new_end_date::text as new_end_date, effective_at::text as effective_at,
              source_document, source_note, superseded_by::text as superseded_by
         from contract_modifications
        where contract_id = $1 and org_id = $2
        order by (effective_at is null), effective_at desc, created_at desc`,
      [contractId, orgId]
    ),
    query<ContractInvoice>(
      `select id, invoice_number, amount_cents, period_start::text as period_start,
              period_end::text as period_end, submitted_at::text as submitted_at,
              paid_at::text as paid_at, paid_cents,
              rejected_at::text as rejected_at, rejected_reason, note
         from contract_invoices
        where contract_id = $1 and org_id = $2
        order by coalesce(submitted_at, created_at) desc`,
      [contractId, orgId]
    ),
    query<ContractIssue>(
      `select id, title, detail, severity, raised_at::text as raised_at,
              resolved_at::text as resolved_at, resolution
         from contract_issues
        where contract_id = $1 and org_id = $2
        order by (resolved_at is null) desc, raised_at desc`,
      [contractId, orgId]
    ),
    query<ContractCoordination>(
      `select id, happened_at::text as happened_at, channel, with_whom, summary,
              subcontractor_id::text as subcontractor_id
         from contract_coordination
        where contract_id = $1 and org_id = $2
        order by happened_at desc`,
      [contractId, orgId]
    ),
  ]);

  /*
   * Superseded modifications do not count toward the value.
   *
   * A correction that stands alongside what it replaced is the point of
   * keeping both; adding both to the total would double the change.
   *
   * The column points forward: a row's `superseded_by` names the row that
   * replaced it. So the ones to drop are the rows that have one, not the ones
   * named by one, which is the opposite of what it first looks like.
   */
  const modTotal = modifications
    .filter((m) => !m.superseded_by)
    .reduce((a, m) => a + (cents(m.value_delta_cents) ?? 0), 0);

  /*
   * Invoiced and paid are null until there is an invoice, not zero.
   *
   * A contract with no invoices has not invoiced nothing; nobody has recorded
   * anything either way, and "$0 invoiced" on a job three months in is a
   * statement somebody would act on.
   */
  const invoicedCents = invoices.length
    ? invoices
        .filter((i) => !i.rejected_at)
        .reduce((a, i) => a + (cents(i.amount_cents) ?? 0), 0)
    : null;
  const paidCents = invoices.length
    ? invoices.reduce((a, i) => a + (cents(i.paid_cents) ?? 0), 0)
    : null;

  const money = contractMoney({
    awardCents: dollarsToCents(header.award_amount),
    subQuoteCents: dollarsToCents(header.sub_quote_total),
    modificationCents: modTotal,
    invoicedCents,
    paidCents,
    retainagePct: header.retainage_pct == null ? null : Number(header.retainage_pct),
  });

  return { header, milestones, modifications, invoices, issues, coordination, money };
}

/** The org owns this contract, checked inside the statement that will write. */
async function ownsContract(orgId: string, contractId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from contracts where id = $1 and org_id = $2`,
    [contractId, orgId]
  );
  return Boolean(row);
}

export async function saveMilestone(input: {
  orgId: string;
  contractId: string;
  milestoneId?: string | null;
  kind: string;
  name: string;
  detail?: string | null;
  dueAt?: string | null;
  amountCents?: number | null;
  evidenceNote?: string | null;
}): Promise<ContractResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: "A milestone needs a name." };
  if (input.kind !== "milestone" && input.kind !== "deliverable") {
    return { ok: false, status: 400, error: "That is not a kind of milestone." };
  }
  if (input.amountCents != null && (!Number.isFinite(input.amountCents) || input.amountCents < 0)) {
    return { ok: false, status: 400, error: "An amount cannot be negative." };
  }

  if (input.milestoneId) {
    const rows = await query<{ id: string }>(
      `update contract_milestones
          set kind = $4, name = $5, detail = $6, due_at = $7::date,
              amount_cents = $8, evidence_note = $9, updated_at = now()
        where id = $3 and contract_id = $1 and org_id = $2
        returning id`,
      [
        input.contractId, input.orgId, input.milestoneId, input.kind, name,
        input.detail?.trim() || null, input.dueAt || null,
        input.amountCents ?? null, input.evidenceNote?.trim() || null,
      ]
    );
    return rows.length
      ? { ok: true, id: input.milestoneId }
      : { ok: false, status: 404, error: "No such milestone." };
  }

  const rows = await query<{ id: string }>(
    /*
     * org_id comes from the contract row rather than from the request, so the
     * tenant guard is inside the statement that inserts. An id from another
     * organization matches nothing and writes nothing.
     */
    `insert into contract_milestones
       (org_id, contract_id, kind, name, detail, due_at, amount_cents, evidence_note, sort_order)
     select c.org_id, c.id, $3, $4, $5, $6::date, $7, $8,
            coalesce((select max(sort_order) + 1 from contract_milestones m where m.contract_id = c.id), 0)
       from contracts c
      where c.id = $1 and c.org_id = $2
     returning id`,
    [
      input.contractId, input.orgId, input.kind, name,
      input.detail?.trim() || null, input.dueAt || null,
      input.amountCents ?? null, input.evidenceNote?.trim() || null,
    ]
  );
  return rows.length
    ? { ok: true, id: rows[0].id }
    : { ok: false, status: 404, error: "No such contract." };
}

export async function completeMilestone(input: {
  orgId: string;
  contractId: string;
  milestoneId: string;
  actorId: string | null;
  evidenceNote?: string | null;
  undo?: boolean;
}): Promise<ContractResult> {
  const rows = await query<{ id: string }>(
    `update contract_milestones
        set completed_at = case when $5 then null else now() end,
            completed_by = case when $5 then null else $4::uuid end,
            evidence_note = coalesce($6, evidence_note),
            updated_at = now()
      where id = $3 and contract_id = $1 and org_id = $2
      returning id`,
    [
      input.contractId, input.orgId, input.milestoneId, input.actorId,
      Boolean(input.undo), input.evidenceNote?.trim() || null,
    ]
  );
  return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such milestone." };
}

export async function removeMilestone(input: {
  orgId: string;
  contractId: string;
  milestoneId: string;
}): Promise<ContractResult> {
  const rows = await query<{ id: string }>(
    `delete from contract_milestones
      where id = $3 and contract_id = $1 and org_id = $2 returning id`,
    [input.contractId, input.orgId, input.milestoneId]
  );
  return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such milestone." };
}

export async function saveModification(input: {
  orgId: string;
  contractId: string;
  modNumber: string;
  kind: string;
  summary: string;
  valueDeltaCents?: number | null;
  newEndDate?: string | null;
  effectiveAt?: string | null;
  sourceDocument?: string | null;
  sourceNote?: string | null;
  supersedes?: string | null;
  actorId: string | null;
}): Promise<ContractResult> {
  const modNumber = input.modNumber.trim();
  const summary = input.summary.trim();
  if (!modNumber) return { ok: false, status: 400, error: "Which modification number is this?" };
  if (!summary) return { ok: false, status: 400, error: "Say what the modification changed." };
  if (!["scope", "value", "schedule", "administrative", "termination"].includes(input.kind)) {
    return { ok: false, status: 400, error: "That is not a kind of modification." };
  }
  /*
   * A value change needs the value. Recording "Mod 3 increased the contract"
   * with no figure is how a contract's worth becomes a thing people argue
   * about from memory.
   */
  if (input.kind === "value" && input.valueDeltaCents == null) {
    return { ok: false, status: 400, error: "A value change needs the amount it changed by." };
  }
  if (!input.sourceDocument?.trim() && !input.sourceNote?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "Say where this came from, so the change can be checked against paper later.",
    };
  }

  return transaction(async (client) => {
    const owner = await client.query(
      `select id from contracts where id = $1 and org_id = $2 for update`,
      [input.contractId, input.orgId]
    );
    if (owner.rowCount === 0) {
      return { ok: false as const, status: 404, error: "No such contract." };
    }

    const dupe = await client.query(
      `select id from contract_modifications
        where contract_id = $1 and org_id = $2 and lower(btrim(mod_number)) = lower($3)`,
      [input.contractId, input.orgId, modNumber]
    );
    if (dupe.rowCount) {
      return {
        ok: false as const,
        status: 409,
        error: `Modification ${modNumber} is already recorded. Supersede it rather than adding it twice.`,
      };
    }

    const res = await client.query<{ id: string }>(
      `insert into contract_modifications
         (org_id, contract_id, mod_number, kind, summary, value_delta_cents,
          new_end_date, effective_at, source_document, source_note, recorded_by)
       values ($2,$1,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11::uuid)
       returning id`,
      [
        input.contractId, input.orgId, modNumber, input.kind, summary,
        input.valueDeltaCents ?? null, input.newEndDate || null, input.effectiveAt || null,
        input.sourceDocument?.trim() || null, input.sourceNote?.trim() || null, input.actorId,
      ]
    );

    if (input.supersedes) {
      await client.query(
        `update contract_modifications set superseded_by = $3
          where id = $4 and contract_id = $1 and org_id = $2`,
        [input.contractId, input.orgId, res.rows[0].id, input.supersedes]
      );
    }

    /*
     * A schedule change moves the contract's end date, so the header follows
     * the modification rather than being edited separately. Two places holding
     * the end date is two places to disagree.
     */
    if (input.newEndDate) {
      await client.query(
        `update contracts set end_date = $3::date, updated_at = now()
          where id = $1 and org_id = $2`,
        [input.contractId, input.orgId, input.newEndDate]
      );
    }

    return { ok: true as const, id: res.rows[0].id };
  });
}

export async function saveInvoice(input: {
  orgId: string;
  contractId: string;
  invoiceId?: string | null;
  invoiceNumber: string;
  amountCents: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  submittedAt?: string | null;
  note?: string | null;
}): Promise<ContractResult> {
  const number = input.invoiceNumber.trim();
  if (!number) return { ok: false, status: 400, error: "An invoice needs a number." };
  if (!Number.isFinite(input.amountCents) || input.amountCents < 0) {
    return { ok: false, status: 400, error: "An invoice amount cannot be negative." };
  }

  if (input.invoiceId) {
    const rows = await query<{ id: string }>(
      `update contract_invoices
          set invoice_number = $4, amount_cents = $5, period_start = $6::date,
              period_end = $7::date, submitted_at = $8::timestamptz, note = $9,
              updated_at = now()
        where id = $3 and contract_id = $1 and org_id = $2
        returning id`,
      [
        input.contractId, input.orgId, input.invoiceId, number, input.amountCents,
        input.periodStart || null, input.periodEnd || null,
        input.submittedAt || null, input.note?.trim() || null,
      ]
    );
    return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such invoice." };
  }

  const rows = await query<{ id: string }>(
    `insert into contract_invoices
       (org_id, contract_id, invoice_number, amount_cents, period_start, period_end, submitted_at, note)
     select c.org_id, c.id, $3, $4, $5::date, $6::date, $7::timestamptz, $8
       from contracts c where c.id = $1 and c.org_id = $2
     returning id`,
    [
      input.contractId, input.orgId, number, input.amountCents,
      input.periodStart || null, input.periodEnd || null,
      input.submittedAt || null, input.note?.trim() || null,
    ]
  ).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : "";
    if (/contract_invoices_number_idx/.test(msg)) throw new ContractRefusal(
      `Invoice ${number} is already recorded on this contract.`
    );
    throw e;
  });
  return rows.length
    ? { ok: true, id: rows[0].id }
    : { ok: false, status: 404, error: "No such contract." };
}

export class ContractRefusal extends Error {}

export async function settleInvoice(input: {
  orgId: string;
  contractId: string;
  invoiceId: string;
  paidCents?: number | null;
  paidAt?: string | null;
  rejectedReason?: string | null;
}): Promise<ContractResult> {
  const rejecting = Boolean(input.rejectedReason?.trim());
  if (rejecting) {
    const rows = await query<{ id: string }>(
      `update contract_invoices
          set rejected_at = now(), rejected_reason = $4,
              paid_at = null, paid_cents = null, updated_at = now()
        where id = $3 and contract_id = $1 and org_id = $2
        returning id`,
      [input.contractId, input.orgId, input.invoiceId, input.rejectedReason!.trim()]
    );
    return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such invoice." };
  }

  if (input.paidCents == null || !Number.isFinite(input.paidCents) || input.paidCents < 0) {
    return { ok: false, status: 400, error: "Say how much was paid." };
  }
  const rows = await query<{ id: string }>(
    `update contract_invoices
        set paid_at = coalesce($5::timestamptz, now()), paid_cents = $4,
            -- Recording a payment clears a rejection: the two are opposite
            -- claims about the same invoice and cannot both stand.
            rejected_at = null, rejected_reason = null, updated_at = now()
      where id = $3 and contract_id = $1 and org_id = $2
      returning id`,
    [input.contractId, input.orgId, input.invoiceId, input.paidCents, input.paidAt || null]
  );
  return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such invoice." };
}

export async function saveIssue(input: {
  orgId: string;
  contractId: string;
  issueId?: string | null;
  title: string;
  detail?: string | null;
  severity: string;
  actorId: string | null;
}): Promise<ContractResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, status: 400, error: "An issue needs a title." };
  if (!["normal", "serious", "blocking"].includes(input.severity)) {
    return { ok: false, status: 400, error: "That is not a severity." };
  }
  if (input.issueId) {
    const rows = await query<{ id: string }>(
      `update contract_issues set title = $4, detail = $5, severity = $6
        where id = $3 and contract_id = $1 and org_id = $2 returning id`,
      [input.contractId, input.orgId, input.issueId, title, input.detail?.trim() || null, input.severity]
    );
    return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such issue." };
  }
  const rows = await query<{ id: string }>(
    `insert into contract_issues (org_id, contract_id, title, detail, severity, raised_by)
     select c.org_id, c.id, $3, $4, $5, $6::uuid
       from contracts c where c.id = $1 and c.org_id = $2
     returning id`,
    [input.contractId, input.orgId, title, input.detail?.trim() || null, input.severity, input.actorId]
  );
  return rows.length
    ? { ok: true, id: rows[0].id }
    : { ok: false, status: 404, error: "No such contract." };
}

export async function resolveIssue(input: {
  orgId: string;
  contractId: string;
  issueId: string;
  resolution: string;
}): Promise<ContractResult> {
  const resolution = input.resolution.trim();
  // Enforced here and in the database. A closed issue with no account of how
  // is one nobody can learn from, which is most of the point of recording it.
  if (!resolution) {
    return { ok: false, status: 400, error: "Say how it was resolved." };
  }
  const rows = await query<{ id: string }>(
    `update contract_issues set resolved_at = now(), resolution = $4
      where id = $3 and contract_id = $1 and org_id = $2 and resolved_at is null
      returning id`,
    [input.contractId, input.orgId, input.issueId, resolution]
  );
  return rows.length
    ? { ok: true }
    : { ok: false, status: 404, error: "No such open issue." };
}

export async function logCoordination(input: {
  orgId: string;
  contractId: string;
  channel: string;
  withWhom: string;
  summary: string;
  happenedAt?: string | null;
  subcontractorId?: string | null;
  actorId: string | null;
}): Promise<ContractResult> {
  const withWhom = input.withWhom.trim();
  const summary = input.summary.trim();
  if (!withWhom) return { ok: false, status: 400, error: "Who was this with?" };
  if (!summary) return { ok: false, status: 400, error: "Say what was discussed." };
  if (!["call", "email", "meeting", "site_visit", "other"].includes(input.channel)) {
    return { ok: false, status: 400, error: "That is not a way to have talked to somebody." };
  }
  const rows = await query<{ id: string }>(
    `insert into contract_coordination
       (org_id, contract_id, happened_at, channel, with_whom, summary, subcontractor_id, recorded_by)
     select c.org_id, c.id, coalesce($3::timestamptz, now()), $4, $5, $6,
            -- Only a subcontractor on this organization's roster.
            (select s.id from subcontractors s where s.id = $7::uuid and s.org_id = c.org_id),
            $8::uuid
       from contracts c where c.id = $1 and c.org_id = $2
     returning id`,
    [
      input.contractId, input.orgId, input.happenedAt || null, input.channel,
      withWhom, summary, input.subcontractorId || null, input.actorId,
    ]
  );
  return rows.length
    ? { ok: true, id: rows[0].id }
    : { ok: false, status: 404, error: "No such contract." };
}

export async function updateContractTerms(input: {
  orgId: string;
  contractId: string;
  fields: Record<string, unknown>;
}): Promise<ContractResult> {
  const allowed = [
    "contract_number", "award_amount", "start_date", "end_date",
    "retainage_pct", "insurance_required", "bond_required_cents", "closeout_notes",
  ] as const;
  const touched = allowed.filter((c) => c in input.fields);
  if (touched.length === 0) return { ok: true };

  const retainage = input.fields.retainage_pct;
  if (retainage != null && retainage !== "") {
    const r = Number(retainage);
    if (!Number.isFinite(r) || r < 0 || r > 100) {
      return { ok: false, status: 400, error: "Retainage is a percentage between 0 and 100." };
    }
  }

  const params: unknown[] = [input.contractId, input.orgId];
  const sets = touched.map((c) => {
    const raw = input.fields[c];
    params.push(raw === "" ? null : raw);
    // Dates need the cast; everything else takes the column's own type.
    return c.endsWith("_date") ? `${c} = $${params.length}::date` : `${c} = $${params.length}`;
  });

  const rows = await query<{ id: string }>(
    `update contracts set ${sets.join(", ")}, updated_at = now()
      where id = $1 and org_id = $2 returning id`,
    params
  );
  return rows.length ? { ok: true } : { ok: false, status: 404, error: "No such contract." };
}

/**
 * Record a contract that did not come from a won bid.
 *
 * A contract could previously only exist as the output of a win, and the win
 * path hard-refuses an award with no bid record. So a contract signed before
 * this account existed, or one that came in by a route the platform never saw,
 * could not be tracked at all.
 */
export async function createContract(input: {
  orgId: string;
  actorId: string | null;
  contractNumber: string;
  awardAmount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  opportunityId?: string | null;
}): Promise<ContractResult> {
  const number = input.contractNumber.trim();
  if (!number) return { ok: false, status: 400, error: "A contract needs its number." };
  if (input.awardAmount != null && (!Number.isFinite(input.awardAmount) || input.awardAmount < 0)) {
    return { ok: false, status: 400, error: "An award amount cannot be negative." };
  }
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    return { ok: false, status: 400, error: "The end date cannot be before the start date." };
  }

  const rows = await query<{ id: string }>(
    `insert into contracts
       (org_id, contract_number, award_amount, start_date, end_date, status,
        created_manually, created_by, opportunity_id)
     values ($1,$2,$3,$4::date,$5::date,'active',true,$6::uuid,
             -- Only an opportunity this organization owns, resolved in the
             -- statement rather than trusted from the request.
             (select o.id from opportunities o where o.id = $7::uuid and o.org_id = $1))
     returning id`,
    [
      input.orgId, number, input.awardAmount ?? null,
      input.startDate || null, input.endDate || null,
      input.actorId, input.opportunityId || null,
    ]
  );
  return rows.length
    ? { ok: true, id: rows[0].id }
    : { ok: false, status: 500, error: "The contract could not be created." };
}

export { ownsContract };
