"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  REQUIREMENT_STATES,
  REQUIREMENT_STATE_LABEL,
  VERIFICATION_KINDS,
  VERIFICATION_LABEL,
  needsAPerson,
  requirementDueState,
  type RequirementAudit,
  type RequirementState,
  type RequirementStateView,
  type VerificationKind,
} from "@/lib/domain/requirement-state";
import type { Owner } from "@/lib/domain/ownership";

/**
 * Where one requirement has got to, and how to change it.
 *
 * Collapsed to a chip until somebody opens it. A checklist is read far more
 * often than it is edited, and forty rows each carrying a state select, an
 * owner select, a date field and a reason box is a screen nobody can scan.
 * The chip is the answer; the editor is one press away.
 *
 * Two things the editor refuses to let happen, and both are the brief's rules
 * rather than this component's preferences. Blocked and Needs clarification
 * require a reason, because a blocked item with no reason tells the next
 * person nothing. And Done stays available to a person at all times: the
 * refusals about signatures and credentials are automation's, not theirs. A
 * person can see the document.
 */
export function RequirementStateControl({
  opportunityId,
  requirementId,
  label,
  view,
  members,
  viewerId,
  history,
  canEdit,
}: {
  opportunityId: string;
  requirementId: string;
  /** The requirement's own label, so the controls can be named for a reader. */
  label: string;
  view: RequirementStateView;
  members: Owner[];
  viewerId?: string;
  history: RequirementAudit[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RequirementState>(view.state);
  const [ownerId, setOwnerId] = useState(view.owner?.id ?? "");
  const [dueAt, setDueAt] = useState(view.dueAt ? view.dueAt.slice(0, 10) : "");
  const [verification, setVerification] = useState<VerificationKind>(view.verification);
  const [reason, setReason] = useState(view.blockingReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const needsReason = state === "blocked" || state === "needs_clarification";

  async function save() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/requirement-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirement_id: requirementId,
          state,
          owner_id: ownerId || null,
          due_at: dueAt || null,
          verification,
          blocking_reason: reason || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        warning?: string | null;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not save that.");
        return;
      }
      if (data.warning) setWarning(data.warning);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  const due = requirementDueState(view.dueAt ? new Date(view.dueAt) : null, new Date());
  const idBase = `req-${requirementId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <StateChip state={view.state} untouched={view.untouched} />
        {view.owner && (
          <span className="badge bg-surface-raised text-slate-600">
            {view.owner.id === viewerId ? "On you" : `On ${view.owner.name}`}
          </span>
        )}
        {due && (
          <span
            className={
              due === "overdue"
                ? "badge bg-risk/10 text-risk"
                : due === "due_soon"
                  ? "badge bg-review/10 text-review"
                  : "badge bg-surface-raised text-slate-600"
            }
          >
            {due === "overdue" ? "Past its own date" : `Its own date: ${formatDay(view.dueAt)}`}
          </span>
        )}
        {needsAPerson(view.verification) && (
          <span className="badge bg-surface-raised text-slate-600">
            {VERIFICATION_LABEL[view.verification]}
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            className="tap text-xs text-accent hover:underline"
            aria-expanded={open}
            aria-controls={`${idBase}-editor`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Update"}
          </button>
        )}
      </div>

      {(view.blockingReason || warning) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {view.blockingReason}
          {view.blockingReason && warning ? " " : ""}
          {warning && <span className="text-review">{warning}</span>}
        </p>
      )}

      {open && canEdit && (
        <div
          id={`${idBase}-editor`}
          className="mt-2 space-y-3 rounded-md border border-border bg-surface-raised p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1 block" htmlFor={`${idBase}-state`}>
                State
              </label>
              <select
                id={`${idBase}-state`}
                className="input h-11 w-full lg:h-9"
                value={state}
                onChange={(e) => setState(e.target.value as RequirementState)}
              >
                {REQUIREMENT_STATES.map((s) => (
                  <option key={s} value={s}>
                    {REQUIREMENT_STATE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label mb-1 block" htmlFor={`${idBase}-owner`}>
                Who is doing it
              </label>
              <select
                id={`${idBase}-owner`}
                className="input h-11 w-full lg:h-9"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === viewerId ? `${m.name} (you)` : m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label mb-1 block" htmlFor={`${idBase}-due`}>
                Its own date
              </label>
              <input
                id={`${idBase}-due`}
                type="date"
                className="input h-11 w-full lg:h-9"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave empty when this is due with the bid and nothing sooner.
              </p>
            </div>
            <div>
              <label className="label mb-1 block" htmlFor={`${idBase}-verify`}>
                What proving it takes
              </label>
              <select
                id={`${idBase}-verify`}
                className="input h-11 w-full lg:h-9"
                value={verification}
                onChange={(e) => setVerification(e.target.value as VerificationKind)}
              >
                {VERIFICATION_KINDS.map((v) => (
                  <option key={v} value={v}>
                    {VERIFICATION_LABEL[v]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Anything but the first one means automation will never close this by itself.
              </p>
            </div>
          </div>

          {needsReason && (
            <div>
              <label className="label mb-1 block" htmlFor={`${idBase}-reason`}>
                {state === "blocked" ? "What is blocking it" : "What is unclear"}
              </label>
              <textarea
                id={`${idBase}-reason`}
                className="input min-h-[4.5rem] w-full"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  state === "blocked"
                    ? "Waiting on the bonding company to confirm the rate."
                    : "Section L.3 asks for three references and Section M asks for five."
                }
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn"
              disabled={busy || (needsReason && !reason.trim())}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            {needsReason && !reason.trim() && (
              <span className="text-xs text-muted-foreground">
                {state === "blocked"
                  ? "Say what is blocking it before saving."
                  : "Say what is unclear before saving."}
              </span>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-risk">
              {error}
            </p>
          )}

          <History label={label} history={history} />
        </div>
      )}
    </div>
  );
}

/**
 * Every change to this requirement, newest first.
 *
 * Kept behind a disclosure rather than off the screen. It is the record an
 * auditor asks for and the record a colleague reads before asking "who moved
 * this", and neither of them should have to leave the page.
 */
function History({ label, history }: { label: string; history: RequirementAudit[] }) {
  if (history.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing has been recorded against this yet.
      </p>
    );
  }
  return (
    <details className="text-xs">
      <summary className="tap cursor-pointer text-accent">
        History for {label} ({history.length})
      </summary>
      <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
        {history.map((h) => (
          <li key={h.id} className="text-muted-foreground">
            <span className="text-foreground">{h.note ?? REQUIREMENT_STATE_LABEL[h.toState]}</span>
            {" · "}
            {h.actorKind === "automation" ? "Automatic" : (h.actorLabel ?? "Somebody here")}
            {" · "}
            {formatMoment(h.at)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function StateChip({ state, untouched }: { state: RequirementState; untouched: boolean }) {
  /*
   * An untouched requirement says so in its own words rather than borrowing
   * "Not started", which reads as a decision somebody made. Nobody has looked
   * at this one, and that is a different fact.
   */
  if (untouched) {
    return <span className="badge bg-surface-raised text-slate-600">Nobody has recorded this</span>;
  }
  const tone: Record<RequirementState, string> = {
    not_started: "bg-surface-raised text-slate-600",
    in_progress: "bg-review/10 text-review",
    needs_clarification: "bg-review/15 text-review",
    blocked: "bg-risk/10 text-risk",
    done: "bg-pursue-soft text-pursue-strong",
    not_applicable: "bg-surface-raised text-slate-600",
  };
  return <span className={`badge ${tone[state]}`}>{REQUIREMENT_STATE_LABEL[state]}</span>;
}

function formatDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMoment(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "at an unrecorded time"
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
