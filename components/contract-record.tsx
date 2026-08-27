"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface RecordMilestone {
  id: string;
  kind: string;
  name: string;
  detail: string | null;
  due_at: string | null;
  completed_at: string | null;
  amount_cents: string | number | null;
  evidence_note: string | null;
}

export interface RecordModification {
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

export interface RecordInvoice {
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
}

export interface RecordIssue {
  id: string;
  title: string;
  detail: string | null;
  severity: string;
  raised_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

export interface RecordCoordination {
  id: string;
  happened_at: string;
  channel: string;
  with_whom: string;
  summary: string;
}

const MOD_KINDS = [
  { value: "scope", label: "Scope" },
  { value: "value", label: "Value" },
  { value: "schedule", label: "Schedule" },
  { value: "administrative", label: "Administrative" },
  { value: "termination", label: "Termination" },
];

const CHANNELS = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "site_visit", label: "Site visit" },
  { value: "other", label: "Other" },
];

const SEVERITIES = [
  { value: "normal", label: "Worth noting" },
  { value: "serious", label: "Serious" },
  { value: "blocking", label: "Stopping work" },
];

/**
 * Everything a contract accumulates after award, with the controls to record it.
 *
 * Milestones and the coordination log were rendered on the card from jsonb
 * columns nothing could write to, so both were permanently empty. The rest --
 * modifications, invoices, payments, issues -- had nowhere to be recorded at
 * all, which meant the record of a live federal contract stopped at its award
 * amount and two dates.
 */
export function ContractRecordSections({
  contractId,
  milestones,
  modifications,
  invoices,
  issues,
  coordination,
  canEdit,
}: {
  contractId: string;
  milestones: RecordMilestone[];
  modifications: RecordModification[];
  invoices: RecordInvoice[];
  issues: RecordIssue[];
  coordination: RecordCoordination[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setMessage({ bad: true, text: data.error ?? "That did not save." });
        return false;
      }
      setMessage({ bad: false, text: data.message ?? "Saved." });
      setOpen(null);
      router.refresh();
      return true;
    } catch {
      setMessage({ bad: true, text: "Could not reach the server. Nothing was saved." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const openIssues = issues.filter((i) => !i.resolved_at);
  const doneIssues = issues.filter((i) => i.resolved_at);

  return (
    <div className="space-y-6">
      <Section
        id="milestones"
        title="Milestones and deliverables"
        blurb="What is due, when, and what the agency was actually given. This was rendered from a column nothing could write to, so it was always empty."
        action={canEdit ? { label: "Add one", key: "milestone", open, setOpen } : null}
        count={milestones.length}
      >
        {milestones.length === 0 ? (
          <Empty>Nothing recorded. Add the dates the contract sets, so they can be counted down.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {m.name}
                    <span className="text-muted-foreground">
                      {" · "}
                      {m.kind === "deliverable" ? "Deliverable" : "Milestone"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.due_at ? `Due ${m.due_at}` : "No date on file"}
                    {m.amount_cents != null ? ` · ${money(m.amount_cents)}` : ""}
                    {m.completed_at ? ` · delivered ${m.completed_at.slice(0, 10)}` : ""}
                  </p>
                  {m.detail && <p className="text-xs text-muted-foreground">{m.detail}</p>}
                  {m.evidence_note && (
                    <p className="text-xs text-muted-foreground">Proof: {m.evidence_note}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-3">
                    <button
                      type="button"
                      className="tap text-xs text-accent hover:underline"
                      disabled={busy}
                      onClick={() =>
                        void post({
                          action: "complete_milestone",
                          milestone_id: m.id,
                          undo: Boolean(m.completed_at),
                        })
                      }
                    >
                      {m.completed_at ? "Mark outstanding" : "Mark delivered"}
                    </button>
                    <button
                      type="button"
                      className="tap text-xs text-risk hover:underline"
                      disabled={busy}
                      onClick={() => void post({ action: "remove_milestone", milestone_id: m.id })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {open === "milestone" && (
          <MilestoneForm busy={busy} onCancel={() => setOpen(null)} onSave={post} />
        )}
      </Section>

      <Section
        id="modifications"
        title="Modifications"
        blurb="Post-award changes to scope, value or dates. Each one carries where it came from, so a value change can be checked against paper later."
        action={canEdit ? { label: "Record one", key: "modification", open, setOpen } : null}
        count={modifications.length}
      >
        {modifications.length === 0 ? (
          <Empty>None recorded.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {modifications.map((m) => (
              <li key={m.id} className={`py-2 ${m.superseded_by ? "opacity-60" : ""}`}>
                <p className="text-sm text-foreground">
                  {m.mod_number}
                  <span className="text-muted-foreground">
                    {" · "}
                    {MOD_KINDS.find((k) => k.value === m.kind)?.label ?? m.kind}
                  </span>
                  {m.superseded_by && (
                    <span className="badge ml-2 bg-surface-raised text-muted-foreground">
                      Superseded
                    </span>
                  )}
                </p>
                <p className="text-sm text-foreground">{m.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {m.value_delta_cents != null ? `${money(m.value_delta_cents)} · ` : ""}
                  {m.effective_at ? `effective ${m.effective_at} · ` : ""}
                  {m.new_end_date ? `new end date ${m.new_end_date} · ` : ""}
                  {/*
                    The source is shown rather than stored quietly. A
                    modification is the thing most likely to be remembered
                    wrong, and the document is what settles it.
                  */}
                  {m.source_document || m.source_note || "no source recorded"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {open === "modification" && (
          <ModificationForm
            busy={busy}
            existing={modifications.filter((m) => !m.superseded_by)}
            onCancel={() => setOpen(null)}
            onSave={post}
          />
        )}
      </Section>

      <Section
        id="invoices"
        title="Invoices and payments"
        blurb="One row per invoice, with its payment on the same row: they are one fact with two dates."
        action={canEdit ? { label: "Add an invoice", key: "invoice", open, setOpen } : null}
        count={invoices.length}
      >
        {invoices.length === 0 ? (
          <Empty>Nothing invoiced yet, or nothing recorded here.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {i.invoice_number} · {money(i.amount_cents)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.rejected_at
                      ? `Refused: ${i.rejected_reason}`
                      : i.paid_at
                        ? `Paid ${i.paid_at.slice(0, 10)} · ${money(i.paid_cents ?? 0)}`
                        : i.submitted_at
                          ? `Submitted ${i.submitted_at.slice(0, 10)}, not yet paid`
                          : "Not submitted"}
                    {i.period_start || i.period_end
                      ? ` · ${i.period_start ?? "?"} to ${i.period_end ?? "?"}`
                      : ""}
                  </p>
                </div>
                {canEdit && !i.paid_at && (
                  <button
                    type="button"
                    className="tap shrink-0 text-xs text-accent hover:underline"
                    onClick={() => setOpen(`settle:${i.id}`)}
                  >
                    Record the outcome
                  </button>
                )}
                {open === `settle:${i.id}` && (
                  <SettleForm
                    busy={busy}
                    invoice={i}
                    onCancel={() => setOpen(null)}
                    onSave={post}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {open === "invoice" && (
          <InvoiceForm busy={busy} onCancel={() => setOpen(null)} onSave={post} />
        )}
      </Section>

      <Section
        id="issues"
        title="Issues"
        blurb="Things that went wrong and what was done about them. The card could only ever name five problems, all worked out from dates."
        action={canEdit ? { label: "Raise one", key: "issue", open, setOpen } : null}
        count={openIssues.length}
      >
        {issues.length === 0 ? (
          <Empty>None raised.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {[...openIssues, ...doneIssues].map((i) => (
              <li key={i.id} className={`py-2 ${i.resolved_at ? "opacity-70" : ""}`}>
                <p className="text-sm text-foreground">
                  {i.title}
                  <span className="text-muted-foreground">
                    {" · "}
                    {SEVERITIES.find((s) => s.value === i.severity)?.label ?? i.severity}
                  </span>
                </p>
                {i.detail && <p className="text-xs text-muted-foreground">{i.detail}</p>}
                <p className="text-xs text-muted-foreground">
                  {i.resolved_at ? `Resolved: ${i.resolution}` : `Open since ${i.raised_at.slice(0, 10)}`}
                </p>
                {canEdit && !i.resolved_at && (
                  <button
                    type="button"
                    className="tap mt-1 text-xs text-accent hover:underline"
                    onClick={() => setOpen(`resolve:${i.id}`)}
                  >
                    Resolve it
                  </button>
                )}
                {open === `resolve:${i.id}` && (
                  <ResolveForm busy={busy} issueId={i.id} onCancel={() => setOpen(null)} onSave={post} />
                )}
              </li>
            ))}
          </ul>
        )}
        {open === "issue" && <IssueForm busy={busy} onCancel={() => setOpen(null)} onSave={post} />}
      </Section>

      <Section
        id="coordination"
        title="Coordination log"
        blurb="Dated contacts showing this company ran the work rather than passing it through. On a set-aside that is the evidence, and the column meant to hold it could not be written."
        action={canEdit ? { label: "Log a contact", key: "coordination", open, setOpen } : null}
        count={coordination.length}
      >
        {coordination.length === 0 ? (
          <Empty>
            Nothing logged. On a small-business set-aside this is what shows the work was run here.
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {coordination.map((c) => (
              <li key={c.id} className="py-2">
                <p className="text-sm text-foreground">
                  {c.with_whom}
                  <span className="text-muted-foreground">
                    {" · "}
                    {CHANNELS.find((x) => x.value === c.channel)?.label ?? c.channel}
                    {" · "}
                    {c.happened_at.slice(0, 10)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{c.summary}</p>
              </li>
            ))}
          </ul>
        )}
        {open === "coordination" && (
          <CoordinationForm busy={busy} onCancel={() => setOpen(null)} onSave={post} />
        )}
      </Section>

      {message && (
        <p role="status" className={`text-xs ${message.bad ? "text-risk" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function Section({
  id, title, blurb, action, count, children,
}: {
  id: string;
  title: string;
  blurb: string;
  action: { label: string; key: string; open: string | null; setOpen: (v: string | null) => void } | null;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {title}
          {count > 0 && <span className="num ml-2 text-muted-foreground">{count}</span>}
        </h2>
        {action && (
          <button
            type="button"
            className="tap text-xs text-accent hover:underline"
            aria-expanded={action.open === action.key}
            onClick={() => action.setOpen(action.open === action.key ? null : action.key)}
          >
            {action.label}
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{blurb}</p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const box = "input h-11 w-full lg:h-9";
type Save = (body: Record<string, unknown>) => Promise<boolean>;

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-raised p-3">{children}</div>;
}

function Buttons({
  busy, disabled, onSave, onCancel, label,
}: {
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn" disabled={busy || disabled} onClick={onSave}>
        {busy ? "Saving…" : label}
      </button>
      <button type="button" className="btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function MilestoneForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: Save }) {
  const [kind, setKind] = useState("milestone");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is it">
          <input className={box} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind" hint="A deliverable is something the agency receives.">
          <select className={box} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="milestone">Milestone</option>
            <option value="deliverable">Deliverable</option>
          </select>
        </Field>
        <Field label="Due">
          <input type="date" className={box} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Amount" hint="Dollars, if this one is tied to a payment.">
          <input className={box} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <Field label="Anything worth knowing">
        <input className={box} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      <Buttons
        busy={busy}
        disabled={!name.trim()}
        onCancel={onCancel}
        label="Add"
        onSave={() =>
          void onSave({
            action: "milestone", kind, name, detail, due_at: dueAt || null,
            amount_cents: amount.trim() ? Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100) : null,
          })
        }
      />
    </Panel>
  );
}

function ModificationForm({
  busy, existing, onCancel, onSave,
}: {
  busy: boolean;
  existing: RecordModification[];
  onCancel: () => void;
  onSave: Save;
}) {
  const [modNumber, setModNumber] = useState("");
  const [kind, setKind] = useState("scope");
  const [summary, setSummary] = useState("");
  const [delta, setDelta] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [effective, setEffective] = useState("");
  const [doc, setDoc] = useState("");
  const [note, setNote] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const sourced = Boolean(doc.trim() || note.trim());
  const valued = kind !== "value" || delta.trim() !== "";

  return (
    <Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Modification number">
          <input className={box} value={modNumber} onChange={(e) => setModNumber(e.target.value)} placeholder="P00001" />
        </Field>
        <Field label="What kind">
          <select className={box} value={kind} onChange={(e) => setKind(e.target.value)}>
            {MOD_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="What it changed">
        <input className={box} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Value change"
          hint="Dollars. Negative when work was taken away."
        >
          <input className={box} inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </Field>
        <Field label="Effective">
          <input type="date" className={box} value={effective} onChange={(e) => setEffective(e.target.value)} />
        </Field>
        <Field label="New end date" hint="Moves the contract's own end date.">
          <input type="date" className={box} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Document" hint="The file this came from.">
          <input className={box} value={doc} onChange={(e) => setDoc(e.target.value)} />
        </Field>
        <Field label="Or where it came from">
          <input className={box} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {existing.length > 0 && (
        <Field label="Does this correct an earlier one?" hint="The one it replaces stays visible and stops counting.">
          <select className={box} value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
            <option value="">No</option>
            {existing.map((m) => (
              <option key={m.id} value={m.id}>{m.mod_number} · {m.summary.slice(0, 40)}</option>
            ))}
          </select>
        </Field>
      )}
      {!sourced && (
        <p className="text-xs text-muted-foreground">
          Name the document or say where this came from. A value change nobody can check against
          paper is one people argue about from memory.
        </p>
      )}
      {!valued && (
        <p className="text-xs text-muted-foreground">A value change needs the amount it changed by.</p>
      )}
      <Buttons
        busy={busy}
        disabled={!modNumber.trim() || !summary.trim() || !sourced || !valued}
        onCancel={onCancel}
        label="Record"
        onSave={() =>
          void onSave({
            action: "modification", mod_number: modNumber, kind, summary,
            value_delta_cents: delta.trim() ? Math.round(Number(delta.replace(/[$,\s]/g, "")) * 100) : null,
            new_end_date: newEnd || null, effective_at: effective || null,
            source_document: doc, source_note: note, supersedes: supersedes || null,
          })
        }
      />
    </Panel>
  );
}

function InvoiceForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: Save }) {
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [submitted, setSubmitted] = useState("");
  return (
    <Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number">
          <input className={box} value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Amount" hint="Dollars.">
          <input className={box} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Period from">
          <input type="date" className={box} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Period to">
          <input type="date" className={box} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Submitted">
        <input type="date" className={box} value={submitted} onChange={(e) => setSubmitted(e.target.value)} />
      </Field>
      <Buttons
        busy={busy}
        disabled={!number.trim() || !amount.trim()}
        onCancel={onCancel}
        label="Add"
        onSave={() =>
          void onSave({
            action: "invoice", invoice_number: number,
            amount_cents: Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100),
            period_start: from || null, period_end: to || null,
            submitted_at: submitted || null,
          })
        }
      />
    </Panel>
  );
}

function SettleForm({
  busy, invoice, onCancel, onSave,
}: {
  busy: boolean;
  invoice: RecordInvoice;
  onCancel: () => void;
  onSave: Save;
}) {
  const [mode, setMode] = useState<"paid" | "refused">("paid");
  const [paid, setPaid] = useState(String(Math.round(Number(invoice.amount_cents) / 100)));
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="w-full">
      <Panel>
        <Field label="What happened">
          <select className={box} value={mode} onChange={(e) => setMode(e.target.value as "paid" | "refused")}>
            <option value="paid">It was paid</option>
            <option value="refused">It was refused</option>
          </select>
        </Field>
        {mode === "paid" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount paid" hint="Dollars. Often less than invoiced, because of retainage.">
              <input className={box} inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </Field>
            <Field label="When">
              <input type="date" className={box} value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Why it was refused" hint="An unpaid invoice and a refused one need opposite next steps.">
            <input className={box} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <Buttons
          busy={busy}
          disabled={mode === "paid" ? !paid.trim() : !reason.trim()}
          onCancel={onCancel}
          label="Record"
          onSave={() =>
            void onSave(
              mode === "paid"
                ? {
                    action: "settle_invoice", invoice_id: invoice.id,
                    paid_cents: Math.round(Number(paid.replace(/[$,\s]/g, "")) * 100),
                    paid_at: when || null,
                  }
                : { action: "settle_invoice", invoice_id: invoice.id, rejected_reason: reason }
            )
          }
        />
      </Panel>
    </div>
  );
}

function IssueForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: Save }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState("normal");
  return (
    <Panel>
      <Field label="What happened">
        <input className={box} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="How bad">
        <select className={box} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Detail">
        <input className={box} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      <Buttons
        busy={busy}
        disabled={!title.trim()}
        onCancel={onCancel}
        label="Raise"
        onSave={() => void onSave({ action: "issue", title, detail, severity })}
      />
    </Panel>
  );
}

function ResolveForm({
  busy, issueId, onCancel, onSave,
}: {
  busy: boolean;
  issueId: string;
  onCancel: () => void;
  onSave: Save;
}) {
  const [resolution, setResolution] = useState("");
  return (
    <Panel>
      <Field label="How was it resolved" hint="A closed issue with no account of how is one nobody can learn from.">
        <input className={box} value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </Field>
      <Buttons
        busy={busy}
        disabled={!resolution.trim()}
        onCancel={onCancel}
        label="Resolve"
        onSave={() => void onSave({ action: "resolve_issue", issue_id: issueId, resolution })}
      />
    </Panel>
  );
}

function CoordinationForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: Save }) {
  const [channel, setChannel] = useState("call");
  const [withWhom, setWithWhom] = useState("");
  const [summary, setSummary] = useState("");
  const [when, setWhen] = useState("");
  return (
    <Panel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who with">
          <input className={box} value={withWhom} onChange={(e) => setWithWhom(e.target.value)} />
        </Field>
        <Field label="How">
          <select className={box} value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="When" hint="Leave empty for now.">
        <input type="date" className={box} value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="What was discussed">
        <input className={box} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Buttons
        busy={busy}
        disabled={!withWhom.trim() || !summary.trim()}
        onCancel={onCancel}
        label="Log it"
        onSave={() =>
          void onSave({
            action: "coordination", channel, with_whom: withWhom, summary,
            happened_at: when ? new Date(when).toISOString() : null,
          })
        }
      />
    </Panel>
  );
}

function money(cents: string | number | null | undefined): string {
  if (cents == null) return "Not on file";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "Not on file";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n / 100)).toLocaleString("en-US")}`;
}
