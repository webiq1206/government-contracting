"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { OwnerPicker } from "@/components/owner-picker";
import type { Owner } from "@/lib/domain/ownership";

export interface ComplianceCardData {
  id: string;
  /** Who here is renewing it. Null means nobody has said. */
  owner?: Owner | null;
  label: string;
  contract_number: string | null;
  dueDisplay: string; // human date or "-"
  dateInputValue: string; // yyyy-mm-dd for the date input, or ""
  statusValue: string; // the operator's override, "" when they have set none
  /** One of the eight states, already resolved on the server. */
  statusLabel: string;
  /** Why it is in that state, in a sentence. Never a bare badge. */
  statusDetail: string;
  /** What to do about it, when there is something. */
  statusFix: string | null;
  countdownText: string;
  /** Days until the effective due date. Null when there is no date at all. */
  daysLeft: number | null;
  color: "green" | "amber" | "red" | "slate";
  notes: string;
  link_url: string;
  doc_url: string;
  /** True for operator-added items (deletable; not touched by the monitor). */
  manual: boolean;
}

export interface CategoryInfo {
  what: string;
  how?: string;
  links: { label: string; url: string }[];
}

/*
 * The states somebody may set by hand.
 *
 * Three of the old options were severities rather than states -- "Warning" and
 * "Critical" said how urgent an item was, not what was true about it -- and
 * the green one was a claim about a date, selectable for an item with
 * no date at all. What is left is the set of things a person can actually
 * assert. "Expiring soon" is absent on purpose: that one is arithmetic, and
 * arithmetic does not need an override.
 */
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Work it out from the dates" },
  { value: "complete", label: "Complete" },
  { value: "incomplete", label: "Incomplete" },
  { value: "blocked", label: "Blocked" },
  { value: "needs_review", label: "Needs human review" },
  { value: "conflicting", label: "Conflicting" },
  { value: "cannot_monitor", label: "Cannot monitor" },
];

function badgeClass(color: ComplianceCardData["color"]): string {
  if (color === "red") return "bg-risk/15 text-risk";
  if (color === "amber") return "bg-review/15 text-review";
  if (color === "green") return "bg-pursue/15 text-pursue";
  return "bg-slate-200 text-slate-600";
}
function countdownClass(color: ComplianceCardData["color"]): string {
  if (color === "red") return "text-risk";
  if (color === "amber") return "text-review";
  return "text-slate-600";
}

export function ComplianceItemCard({
  item,
  info,
  highlight = false,
  members = [],
  viewerId,
  canAssign = false,
}: {
  item: ComplianceCardData;
  info?: CategoryInfo;
  highlight?: boolean;
  /** Everybody in this organization, for the owner picker. */
  members?: Owner[];
  viewerId?: string;
  canAssign?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function remove() {
    setAsking(false);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not delete.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const [form, setForm] = useState({
    due_at_override: item.dateInputValue,
    status_override: item.statusValue,
    link_url: item.link_url,
    doc_url: item.doc_url,
    notes: item.notes,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="card space-y-3">
        <p className="text-sm font-medium text-slate-900">{item.label}</p>
        <label className="block">
          <span className="label mb-1 block">Renewal / due date</span>
          <input
            type="date"
            className="input"
            value={form.due_at_override}
            onChange={(e) => set("due_at_override", e.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Set this and the board counts down and warns you before it lapses.
          </span>
        </label>
        <label className="block">
          <span className="label mb-1 block">Status</span>
          <select
            className="input"
            value={form.status_override}
            onChange={(e) => set("status_override", e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1 block">Renewal / reference link</span>
          <input
            className="input"
            placeholder="https://"
            value={form.link_url}
            onChange={(e) => set("link_url", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label mb-1 block">Link to your document</span>
          <input
            className="input"
            placeholder="Paste a link to the certificate or policy (e.g. a Drive link)"
            value={form.doc_url}
            onChange={(e) => set("doc_url", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label mb-1 block">Notes</span>
          <textarea
            className="input"
            rows={2}
            placeholder="Anything to remember, e.g. renewed by, policy number..."
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
          >
            Cancel
          </button>
          {error && <span className="text-sm text-risk">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`card ${highlight ? "border-risk/50 bg-risk/5" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {item.label}
            {item.manual && (
              <span className="badge ml-1.5 bg-muted text-muted-foreground">yours</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Due {item.dueDisplay}
            {item.contract_number ? ` · ${item.contract_number}` : ""}
          </p>
          {/*
            Who is renewing it. A lapsed certification is the failure mode
            this whole page exists to prevent, and the commonest way one lapses
            in an office of more than one person is that everybody assumed
            somebody else had it in hand.
          */}
          <div className="mt-2 max-w-[12rem]">
            <OwnerPicker
              kind="compliance"
              recordId={item.id}
              owner={item.owner ?? null}
              members={members}
              viewerId={viewerId}
              canAssign={canAssign}
              compact
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`badge ${badgeClass(item.color)}`}>{item.statusLabel}</span>
          <span className={`num text-xs ${countdownClass(item.color)}`}>
            {item.countdownText}
          </span>
        </div>
      </div>

      {/*
        The sentence behind the badge, above the reference material.
        "Expiring soon" alone is a word to interpret; "9 days left" and "Start
        the renewal now, so it does not lapse while it is in a queue" is what
        somebody acts on. The badge was the only thing this card said about
        its own state.
      */}
      <p className="mt-2 text-xs leading-relaxed text-foreground">
        {item.statusDetail}
        {item.statusFix ? <span className="text-muted-foreground"> {item.statusFix}</span> : null}
      </p>

      {info && (
        <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-slate-500">
          {info.what}
          {info.how ? ` ${info.how}` : ""}
        </p>
      )}

      {item.notes && (
        <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{item.notes}</p>
      )}

      <ConfirmDialog
        open={asking}
        title={`Delete "${item.label}"?`}
        body="The item and its history go. Evidence files already uploaded against it stay on the account."
        confirmLabel="Delete it"
        danger
        busy={saving}
        onConfirm={() => void remove()}
        onCancel={() => setAsking(false)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-ghost text-xs" onClick={() => setEditing(true)}>
          Edit
        </button>
        {item.manual && (
          <button
            className="btn-ghost text-xs text-risk"
            onClick={() => setAsking(true)}
            disabled={saving}
          >
            Delete
          </button>
        )}
        {item.link_url && (
          <a
            href={item.link_url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost text-xs"
          >
            Renewal link ↗
          </a>
        )}
        {item.doc_url && (
          <a
            href={item.doc_url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-ghost text-xs"
          >
            View document ↗
          </a>
        )}
        {/*
          * Lighter than the buttons beside them on purpose -- these leave the
          * product -- but `tap` still gives each one a 44px hit area on a
          * touch screen. Weight and target size are separate decisions, and
          * the sweep caught these once the board had data in it.
          */}
        {info?.links.map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer noopener"
            className="tap text-xs text-accent hover:underline"
          >
            {l.label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}
