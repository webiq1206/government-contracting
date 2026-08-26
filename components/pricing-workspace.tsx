"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONFIDENCE,
  CONFIDENCE_LABEL,
  COVERED_BY,
  COVERED_BY_LABEL,
  type Alternate,
  type CoveredBy,
  type Exclusion,
  type PricedRow,
  type PricingRow,
  type PricingSheet,
  type RowProblem,
  type Scenario,
} from "@/lib/domain/pricing-row";

/**
 * The pricing workspace: one row per trade scope, and what each one is
 * missing.
 *
 * The screen this replaces was a quote form and a total. Its failure mode was
 * not showing a wrong number, it was showing a confident one: a total assembled
 * from a remembered phone figure looked exactly like a total assembled from
 * signed quotes.
 *
 * So the layout is organised around absence. The problems on a row are not
 * behind a disclosure; they sit under the trade name in the same column an
 * operator is already reading, and a trade whose cost is unknown prints the
 * word rather than a currency-formatted zero. The total at the bottom does the
 * same: when one trade of five is unknown there is no total, because there
 * isn't one.
 *
 * Every figure is computed on the server and passed in. Recomputing here
 * against the browser's clock would give a quote that expires today one answer
 * during rendering and another after hydration, and the arithmetic would live
 * in two places.
 */

interface SubOption {
  subcontractor_id: string;
  company_name: string;
}

export function PricingWorkspace({
  opportunityId,
  sheet,
  scenarios,
  subs,
  formula,
  canPrice,
  lastCalculatedAt,
  targetMarginPct,
}: {
  opportunityId: string;
  sheet: PricingSheet;
  /** Side-by-side scenarios, computed on the server from the same cost. */
  scenarios: Scenario[];
  subs: SubOption[];
  /** The arithmetic written out, from `explainBidMath`. */
  formula: string[];
  canPrice: boolean;
  /**
   * When the rows were last touched. Null when nothing has been priced, which
   * is not the same as "just now" and must not render as it.
   */
  lastCalculatedAt: Date | null;
  targetMarginPct: number | null;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const rows = [...sheet.rows, ...sheet.orphanedRows];

  return (
    <div className="space-y-6">
      <div className="card scroll-mt-editorial" id="pricing-rows" data-guide-target="pricing-rows">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">
            Trade pricing · <span className="num">{sheet.rows.length}</span>
          </p>
          <p
            className={`text-xs ${
              sheet.blockers.length > 0 ? "font-medium text-risk" : "text-muted-foreground"
            }`}
          >
            {sheet.blockers.length > 0
              ? `${sheet.blockers.length} thing${sheet.blockers.length === 1 ? "" : "s"} stopping this bid`
              : "Nothing outstanding on the pricing"}
          </p>
        </div>

        {sheet.missingTrades.length > 0 && (
          <p className="mb-3 rounded-md bg-risk/10 px-3 py-2 text-sm text-risk">
            No pricing row yet for {sheet.missingTrades.join(", ")}. Until there is one, this bid has
            no cost, not a lower one.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No trades identified for this solicitation yet. The analysis names the trades, and each
            one gets a row here.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Trade</th>
                    <th className="py-2 pr-3 font-medium">Subcontractor</th>
                    <th className="py-2 pr-3 text-right font-medium">Base quote</th>
                    <th className="py-2 pr-3 text-right font-medium">Adders</th>
                    <th className="py-2 pr-3 text-right font-medium">Trade total</th>
                    <th className="py-2 pr-3 font-medium">Quote</th>
                    <th className="py-2 font-medium">Good until</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((p) => (
                    <Row
                      key={p.row.scopeKey}
                      priced={p}
                      inScope={!sheet.orphanedRows.includes(p)}
                      onEdit={canPrice ? () => setOpen(p.row.scopeKey) : undefined}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border">
                    <td className="py-3 pr-3 font-medium text-foreground" colSpan={4}>
                      Cost of the work
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <Money value={sheet.cost} strong />
                    </td>
                    <td className="py-3" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Narrow screens: one card per trade. The problems stay, because
                they are the reason to look at the row at all. */}
            <ul className="divide-y divide-border lg:hidden">
              {rows.map((p) => (
                <RowCard
                  key={p.row.scopeKey}
                  priced={p}
                  inScope={!sheet.orphanedRows.includes(p)}
                  onEdit={canPrice ? () => setOpen(p.row.scopeKey) : undefined}
                />
              ))}
            </ul>
            <div className="mt-3 flex items-baseline justify-between border-t-2 border-border pt-3 lg:hidden">
              <span className="font-medium text-foreground">Cost of the work</span>
              <Money value={sheet.cost} strong />
            </div>
          </>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          {lastCalculatedAt
            ? `Last change to the pricing: ${lastCalculatedAt.toLocaleString()}.`
            : "Nothing has been priced yet."}
        </p>
      </div>

      <ScenarioTable scenarios={scenarios} formula={formula} targetMarginPct={targetMarginPct} />

      {open && (
        <RowEditor
          opportunityId={opportunityId}
          row={rows.find((p) => p.row.scopeKey === open)!.row}
          subs={subs}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/**
 * A money cell.
 *
 * Null prints "Not known". It is the single most repeated rule in this file
 * and the reason the component exists: `${value.toLocaleString()}` on a null
 * gives "$0", and a trade nobody has priced reading zero is a bid that is too
 * low by exactly the amount nobody has found out.
 */
function Money({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value == null) {
    return <span className="text-sm text-muted-foreground">Not known</span>;
  }
  return (
    <span className={`num ${strong ? "font-medium text-foreground" : ""}`}>
      {value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
    </span>
  );
}

function Problems({ problems }: { problems: RowProblem[] }) {
  const shown = problems.filter((p) => p.severity !== "note");
  if (shown.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((p, i) => (
        <li
          key={`${p.code}-${i}`}
          className={`text-xs ${p.severity === "blocker" ? "text-risk" : "text-muted-foreground"}`}
        >
          {p.message}
          {p.fix ? <span className="text-muted-foreground"> {p.fix}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Adders({ priced }: { priced: PricedRow }) {
  const parts = priced.cost.parts.filter((p) => p.component !== "baseQuote");
  const alternates = priced.row.alternates.filter((a) => a.included);
  if (parts.length === 0 && alternates.length === 0) {
    return <span className="text-xs text-muted-foreground">None</span>;
  }
  if (priced.alternatesTotal == null) {
    return <span className="text-xs text-muted-foreground">Not known</span>;
  }
  const sum = parts.reduce((s, p) => s + p.amount, 0) + priced.alternatesTotal;
  return <Money value={sum} />;
}

function ConfidenceMark({ row }: { row: PricingRow }) {
  const tone =
    row.confidence === "firm"
      ? "bg-pursue/10 text-pursue"
      : row.confidence === "unknown"
        ? "bg-risk/15 text-risk"
        : "bg-review/15 text-review";
  return <span className={`badge ${tone}`}>{CONFIDENCE_LABEL[row.confidence]}</span>;
}

function Row({
  priced,
  inScope,
  onEdit,
}: {
  priced: PricedRow;
  inScope: boolean;
  onEdit?: () => void;
}) {
  const { row } = priced;
  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <p className="font-medium text-foreground">{row.trade}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[
            inScope ? null : "Not in the current trade list",
            row.derived ? "From the quote screen, not reviewed here" : null,
            row.exclusions.length > 0
              ? `${row.exclusions.length} exclusion${row.exclusions.length === 1 ? "" : "s"}`
              : null,
            row.leadTimeDays != null ? `${row.leadTimeDays} day lead time` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Problems problems={priced.problems} />
        {onEdit && (
          <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={onEdit}>
            Edit this row
          </button>
        )}
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        {row.selectedSubName ?? <span className="text-xs">Nobody selected</span>}
        {row.backupSubName && (
          <p className="mt-0.5 text-xs text-muted-foreground">Backup: {row.backupSubName}</p>
        )}
        {(row.candidates?.length ?? 0) > 1 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="num">{row.candidates!.length}</span> quotes on file
          </p>
        )}
      </td>
      <td className="py-2 pr-3 text-right">
        <Money value={row.baseQuote} />
      </td>
      <td className="py-2 pr-3 text-right">
        <Adders priced={priced} />
      </td>
      <td className="py-2 pr-3 text-right">
        <Money value={priced.total} strong />
      </td>
      <td className="py-2 pr-3">
        <ConfidenceMark row={row} />
      </td>
      <td className="py-2 text-muted-foreground">
        {/* An unrecorded expiry is not "no expiry". */}
        {row.quoteExpiresOn ?? <span className="text-xs">Not recorded</span>}
      </td>
    </tr>
  );
}

function RowCard({
  priced,
  inScope,
  onEdit,
}: {
  priced: PricedRow;
  inScope: boolean;
  onEdit?: () => void;
}) {
  const { row } = priced;
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-foreground">{row.trade}</p>
        <Money value={priced.total} strong />
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {row.selectedSubName ?? "Nobody selected"}
        {inScope ? "" : " · Not in the current trade list"}
      </p>
      <div className="mt-1">
        <ConfidenceMark row={row} />
      </div>
      <Problems problems={priced.problems} />
      {onEdit && (
        <button type="button" className="mt-2 text-xs underline underline-offset-2" onClick={onEdit}>
          Edit this row
        </button>
      )}
    </li>
  );
}

/**
 * Scenario comparison.
 *
 * A comparison table is the easiest place in a product to print a confident
 * zero, so when the cost is unknown every scenario says so in words instead of
 * showing a tidy column computed from a cost of nothing.
 */
function ScenarioTable({
  scenarios,
  formula,
  targetMarginPct,
}: {
  scenarios: Scenario[];
  formula: string[];
  targetMarginPct: number | null;
}) {
  const [showFormula, setShowFormula] = useState(false);
  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">What the bid could be</p>
        <button
          type="button"
          className="text-xs underline underline-offset-2"
          onClick={() => setShowFormula((v) => !v)}
          aria-expanded={showFormula}
        >
          {showFormula ? "Hide the arithmetic" : "Show the arithmetic"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Scenario</th>
              <th className="py-2 pr-3 text-right font-medium">Bid</th>
              <th className="py-2 pr-3 text-right font-medium">Cost + contingency</th>
              <th className="py-2 pr-3 text-right font-medium">Gross profit</th>
              <th className="py-2 pr-3 text-right font-medium">Margin (of bid)</th>
              <th className="py-2 text-right font-medium">Markup (of cost)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {scenarios.map((s) => (
              <tr key={s.label} className="align-top">
                <td className="py-2 pr-3">
                  <p className="text-foreground">{s.label}</p>
                  {s.unknown && <p className="mt-0.5 text-xs text-muted-foreground">{s.unknown}</p>}
                  {s.math.belowCost && (
                    <p className="mt-0.5 text-xs text-risk">This bid is below what the job costs.</p>
                  )}
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money value={s.math.bid} strong />
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money value={s.math.loadedCost} />
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money value={s.math.grossProfit} />
                </td>
                <td className="py-2 pr-3 text-right">
                  <Percent value={s.math.marginPct} />
                </td>
                <td className="py-2 text-right">
                  <Percent value={s.math.markupPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Margin is profit divided by the bid. Markup is profit divided by the cost. They are different
        numbers: at a 20% margin the markup is 25%, and pricing a 20% markup while believing it is a
        20% margin gives away a fifth of the profit.
        {targetMarginPct != null ? ` This account targets ${targetMarginPct}% margin.` : ""}
      </p>

      {showFormula && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          {formula.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Percent({ value }: { value: number | null }) {
  if (value == null) return <span className="text-sm text-muted-foreground">Not known</span>;
  return <span className="num">{value}%</span>;
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

const MONEY_FIELDS = [
  ["baseQuote", "Base quote", "What the subcontractor quoted for their own scope."],
  ["taxes", "Taxes", "Sales or use tax somebody has to pay on this trade."],
  ["freight", "Freight", "Delivery of materials to site, when it is not in the quote."],
  ["mobilization", "Mobilisation", "Getting crew and equipment to site."],
  ["bonding", "Bonding", "The bond premium attributable to this trade."],
] as const;

type MoneyField = (typeof MONEY_FIELDS)[number][0];

/**
 * One trade's row, editable.
 *
 * Each money field has a checkbox beside it saying "applies, amount not known
 * yet". That control is the whole point of the form: without it a blank box
 * means both "no freight on this trade" and "freight, nobody asked", and the
 * total silently treats the second as the first.
 */
function RowEditor({
  opportunityId,
  row,
  subs,
  onClose,
}: {
  opportunityId: string;
  row: PricingRow;
  subs: SubOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    baseQuote: row.baseQuote?.toString() ?? "",
    taxes: row.taxes?.toString() ?? "",
    freight: row.freight?.toString() ?? "",
    mobilization: row.mobilization?.toString() ?? "",
    bonding: row.bonding?.toString() ?? "",
    manualAdjustment: row.manualAdjustment?.toString() ?? "",
    manualAdjustmentReason: row.manualAdjustmentReason ?? "",
    selectedSubId: row.selectedSubId ?? "",
    backupSubId: row.backupSubId ?? "",
    paymentTerms: row.paymentTerms ?? "",
    quoteExpiresOn: row.quoteExpiresOn ?? "",
    availability: row.availability ?? "",
    leadTimeDays: row.leadTimeDays?.toString() ?? "",
    confidence: row.confidence,
  }));
  const [pending, setPending] = useState<Set<string>>(new Set(row.pendingComponents));
  const [alternates, setAlternates] = useState<Alternate[]>(row.alternates);
  const [exclusions, setExclusions] = useState<Exclusion[]>(row.exclusions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(patch: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function togglePending(field: MoneyField) {
    setPending((p) => {
      const next = new Set(p);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/pricing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trade: row.trade,
        selectedSubId: form.selectedSubId || null,
        backupSubId: form.backupSubId || null,
        baseQuote: form.baseQuote === "" ? null : form.baseQuote,
        taxes: form.taxes === "" ? null : form.taxes,
        freight: form.freight === "" ? null : form.freight,
        mobilization: form.mobilization === "" ? null : form.mobilization,
        bonding: form.bonding === "" ? null : form.bonding,
        manualAdjustment: form.manualAdjustment === "" ? null : form.manualAdjustment,
        manualAdjustmentReason: form.manualAdjustmentReason || null,
        pendingComponents: [...pending],
        alternates: alternates.map((a) => ({ label: a.label, amount: a.amount, included: a.included })),
        exclusions: exclusions.map((e) => ({
          text: e.text,
          covered_by: e.coveredBy,
          note: e.note ?? null,
        })),
        paymentTerms: form.paymentTerms || null,
        quoteExpiresOn: form.quoteExpiresOn || null,
        availability: form.availability || null,
        leadTimeDays: form.leadTimeDays === "" ? null : form.leadTimeDays,
        confidence: form.confidence,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "The row could not be saved.");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="card border-accent">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-normal text-foreground">{row.trade}</h3>
        <button type="button" className="text-xs underline underline-offset-2" onClick={onClose}>
          Close without saving
        </button>
      </div>

      {(row.candidates?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-md bg-muted/40 px-3 py-2">
          <p className="label mb-1">Quotes on file</p>
          <ul className="space-y-1 text-sm">
            {row.candidates!.map((c) => (
              <li key={c.quoteId} className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">{c.subName ?? "Unnamed subcontractor"}</span>
                <span className="flex items-baseline gap-3">
                  <Money value={c.amount} />
                  <button
                    type="button"
                    className="text-xs underline underline-offset-2"
                    onClick={() =>
                      set({
                        baseQuote: c.amount.toString(),
                        selectedSubId: c.subId ?? "",
                        paymentTerms: c.paymentTerms ?? form.paymentTerms,
                      })
                    }
                  >
                    Use this one
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {(row.candidates?.length ?? 0) > 1 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Check what each one excluded before choosing. The cheapest quote is regularly the one
              that left the most out.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subcontractor doing the work">
          <select
            className="input"
            value={form.selectedSubId}
            onChange={(e) => set({ selectedSubId: e.target.value })}
          >
            <option value="">Nobody selected yet</option>
            {subs.map((s) => (
              <option key={s.subcontractor_id} value={s.subcontractor_id}>
                {s.company_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Backup, if they fall through">
          <select
            className="input"
            value={form.backupSubId}
            onChange={(e) => set({ backupSubId: e.target.value })}
          >
            <option value="">No backup</option>
            {subs
              .filter((s) => s.subcontractor_id !== form.selectedSubId)
              .map((s) => (
                <option key={s.subcontractor_id} value={s.subcontractor_id}>
                  {s.company_name}
                </option>
              ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 space-y-3">
        {MONEY_FIELDS.map(([field, label, help]) => (
          <div key={field} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
            <Field label={label} help={help}>
              <input
                className="input"
                inputMode="decimal"
                placeholder="Not known"
                value={form[field]}
                disabled={pending.has(field)}
                onChange={(e) => set({ [field]: e.target.value } as Partial<typeof form>)}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted-foreground sm:pt-5">
              <input
                type="checkbox"
                checked={pending.has(field)}
                onChange={() => togglePending(field)}
              />
              Applies, amount not known yet
            </label>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label="Manual adjustment"
          help="Positive or negative. A number nobody can account for is not a number, so this one needs a reason."
        >
          <input
            className="input"
            inputMode="decimal"
            placeholder="None"
            value={form.manualAdjustment}
            onChange={(e) => set({ manualAdjustment: e.target.value })}
          />
        </Field>
        <Field label="Why it was adjusted">
          <input
            className="input"
            placeholder="Quote excluded the temporary power drop"
            value={form.manualAdjustmentReason}
            onChange={(e) => set({ manualAdjustmentReason: e.target.value })}
          />
        </Field>
      </div>

      <AlternateEditor alternates={alternates} onChange={setAlternates} />
      <ExclusionEditor exclusions={exclusions} onChange={setExclusions} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="How firm the number is">
          <select
            className="input"
            value={form.confidence}
            onChange={(e) => set({ confidence: e.target.value as PricingRow["confidence"] })}
          >
            {CONFIDENCE.map((c) => (
              <option key={c} value={c}>
                {CONFIDENCE_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment terms">
          <input
            className="input"
            placeholder="Net 30"
            value={form.paymentTerms}
            onChange={(e) => set({ paymentTerms: e.target.value })}
          />
        </Field>
        <Field label="Quote good until" help="Leave blank if they did not say.">
          <input
            className="input"
            type="date"
            value={form.quoteExpiresOn}
            onChange={(e) => set({ quoteExpiresOn: e.target.value })}
          />
        </Field>
        <Field label="Availability">
          <input
            className="input"
            placeholder="Crew free from mid-July"
            value={form.availability}
            onChange={(e) => set({ availability: e.target.value })}
          />
        </Field>
        <Field label="Lead time in days">
          <input
            className="input"
            inputMode="numeric"
            placeholder="Not known"
            value={form.leadTimeDays}
            onChange={(e) => set({ leadTimeDays: e.target.value })}
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-risk">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving" : "Save this row"}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {help && <span className="mt-0.5 block text-xs text-muted-foreground">{help}</span>}
    </label>
  );
}

function AlternateEditor({
  alternates,
  onChange,
}: {
  alternates: Alternate[];
  onChange: (next: Alternate[]) => void;
}) {
  return (
    <div className="mt-4">
      <p className="label mb-1">Alternates</p>
      {alternates.length === 0 && (
        <p className="text-xs text-muted-foreground">None on this trade.</p>
      )}
      <ul className="space-y-2">
        {alternates.map((a, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-center">
            <input
              className="input"
              placeholder="What the alternate is"
              value={a.label}
              onChange={(e) =>
                onChange(alternates.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <input
              className="input"
              inputMode="decimal"
              placeholder="Not priced"
              value={a.amount?.toString() ?? ""}
              onChange={(e) =>
                onChange(
                  alternates.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          // An empty box is an unpriced alternate, not a free one.
                          amount: e.target.value === "" ? null : Number(e.target.value),
                        }
                      : x
                  )
                )
              }
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={a.included}
                onChange={(e) =>
                  onChange(
                    alternates.map((x, j) => (j === i ? { ...x, included: e.target.checked } : x))
                  )
                }
              />
              In the bid
            </label>
            <button
              type="button"
              className="text-xs underline underline-offset-2"
              onClick={() => onChange(alternates.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-2 text-xs underline underline-offset-2"
        onClick={() => onChange([...alternates, { label: "", amount: null, included: false }])}
      >
        Add an alternate
      </button>
    </div>
  );
}

/**
 * Exclusions, and who is carrying them.
 *
 * The `coveredBy` control is not optional metadata. Work a subcontractor
 * writes out of their price does not make the trade cheaper, it makes the bid
 * incomplete, and until somebody says where that work went the row blocks.
 */
function ExclusionEditor({
  exclusions,
  onChange,
}: {
  exclusions: Exclusion[];
  onChange: (next: Exclusion[]) => void;
}) {
  return (
    <div className="mt-4">
      <p className="label mb-1">What they excluded</p>
      {exclusions.length === 0 && (
        <p className="text-xs text-muted-foreground">Nothing recorded as excluded.</p>
      )}
      <ul className="space-y-2">
        {exclusions.map((e, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-center">
            <input
              className="input"
              placeholder="Crane and rigging"
              value={e.text}
              onChange={(ev) =>
                onChange(exclusions.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))
              }
            />
            <select
              className="input"
              value={e.coveredBy}
              onChange={(ev) =>
                onChange(
                  exclusions.map((x, j) =>
                    j === i ? { ...x, coveredBy: ev.target.value as CoveredBy } : x
                  )
                )
              }
            >
              {COVERED_BY.map((c) => (
                <option key={c} value={c}>
                  {COVERED_BY_LABEL[c]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs underline underline-offset-2"
              onClick={() => onChange(exclusions.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-2 text-xs underline underline-offset-2"
        onClick={() => onChange([...exclusions, { text: "", coveredBy: "unassigned", note: null }])}
      >
        Add an exclusion
      </button>
    </div>
  );
}
