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
  /*
   * The facts an item needs to be worked, none of which the editor could
   * reach: which timezone the date lives in, how often it repeats, how far
   * ahead it warns, what happens when nobody acts, and when a person last
   * confirmed it against a document.
   */
  timeZone: string;
  recurrence: string;
  recurrenceMonths: string;
  windowDays: string;
  escalateAfterDays: string;
  escalateTo: string;
  blockedBy: string;
  conflictDetail: string;
  needsReviewReason: string;
  verifiedAt: string | null;
  /** True when the platform has something it can actually check. */
  monitorable: boolean;
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
const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "It does not repeat" },
  { value: "annual", label: "Every year" },
  { value: "semiannual", label: "Every six months" },
  { value: "quarterly", label: "Every three months" },
  { value: "monthly", label: "Every month" },
  { value: "custom", label: "Every so many months" },
];

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
    time_zone: item.timeZone,
    recurrence: item.recurrence,
    recurrence_months: item.recurrenceMonths,
    window_days: item.windowDays,
    escalate_after_days: item.escalateAfterDays,
    escalate_to: item.escalateTo,
    blocked_by: item.blockedBy,
    conflict_detail: item.conflictDetail,
    needs_review_reason: item.needsReviewReason,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /**
   * A single claim, posted on its own.
   *
   * Verifying and renewing are statements a person makes about the item
   * rather than edits to a form, and folding them into the save button would
   * mean somebody who opened the editor to fix a typo could also, without
   * meaning to, assert they had checked the certificate.
   */
  async function act(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-1 block">How often it repeats</span>
            <select
              className="input"
              value={form.recurrence}
              onChange={(e) => set("recurrence", e.target.value)}
            >
              {RECURRENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              {/*
                Without this every renewal was a new item somebody had to
                remember to create, which is the memory this board exists to
                replace.
              */}
              Renewing rolls the date forward instead of leaving it expired.
            </span>
          </label>
          {form.recurrence === "custom" && (
            <label className="block">
              <span className="label mb-1 block">Every how many months</span>
              <input
                className="input"
                inputMode="numeric"
                value={form.recurrence_months}
                onChange={(e) => set("recurrence_months", e.target.value)}
              />
            </label>
          )}
          <label className="block">
            <span className="label mb-1 block">Warn this many days ahead</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="30"
              value={form.window_days}
              onChange={(e) => set("window_days", e.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              A bond is not a W-9. Leave empty for the usual thirty.
            </span>
          </label>
          <label className="block">
            <span className="label mb-1 block">Timezone the date is in</span>
            <input
              className="input"
              placeholder="America/Denver"
              value={form.time_zone}
              onChange={(e) => set("time_zone", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label mb-1 block">Escalate after this many days</span>
            <input
              className="input"
              inputMode="numeric"
              value={form.escalate_after_days}
              onChange={(e) => set("escalate_after_days", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label mb-1 block">Escalate to</span>
            <input
              className="input"
              placeholder="Who hears about it when nobody acts"
              value={form.escalate_to}
              onChange={(e) => set("escalate_to", e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="label mb-1 block">Waiting on something else</span>
          <input
            className="input"
            placeholder="What has to happen first"
            value={form.blocked_by}
            onChange={(e) => set("blocked_by", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label mb-1 block">Two sources disagree</span>
          <input
            className="input"
            placeholder="What each one says"
            value={form.conflict_detail}
            onChange={(e) => set("conflict_detail", e.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Filling this in puts the item above everything else, because you cannot act on
            either side of a disagreement until it is settled.
          </span>
        </label>
        <label className="block">
          <span className="label mb-1 block">Needs somebody to look at it</span>
          <input
            className="input"
            placeholder="Why a person has to confirm this"
            value={form.needs_review_reason}
            onChange={(e) => set("needs_review_reason", e.target.value)}
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
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          {/*
            Separate from Save. Both are claims a person makes about the item
            rather than edits to a form, and folding them into the save button
            would let somebody fixing a typo also assert they had checked the
            certificate.
          */}
          <button
            className="btn-ghost"
            onClick={() => void act({ verified: true })}
            disabled={saving}
          >
            I have checked this against the document
          </button>
          {item.recurrence && (
            <button
              className="btn-ghost"
              onClick={() => void act({ renewed: true })}
              disabled={saving}
            >
              Renewed, roll the date forward
            </button>
          )}
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

      {/*
        When a person last confirmed it, as distinct from when a machine last
        looked. An item checked against the actual certificate is a different
        thing from one a nightly sweep read a date off, and the record could
        not tell them apart.
      */}
      <p className="mt-1 text-xs text-muted-foreground">
        {item.verifiedAt
          ? `Checked against the document ${item.verifiedAt.slice(0, 10)}.`
          : "Nobody here has confirmed this against the document."}
        {item.recurrence ? " Repeats." : ""}
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
