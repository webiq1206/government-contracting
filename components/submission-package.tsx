"use client";

/**
 * The submission package panel: priced bid, the full compliance matrix (every
 * requirement with its status + a way to mark operator items complete), the
 * ordered file manifest with downloads, a one-click full-package ZIP, and a
 * Submit button gated on validation. This is where the operator confirms the
 * package is complete and sends it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Bid,
  ResolvedRequirement,
  PackageItem,
  PackageValidation,
  QaChecklistItem,
} from "@/lib/types";
import { currency, pct, timeAgo } from "@/lib/format";

const STATUS_META: Record<
  ResolvedRequirement["status"],
  { label: string; className: string; icon: string }
> = {
  satisfied: { label: "Included", className: "text-pursue", icon: "✓" },
  needs_signature: { label: "Needs your signature", className: "text-review", icon: "✎" },
  needs_operator: { label: "You must provide", className: "text-review", icon: "▲" },
  missing: { label: "Missing", className: "text-risk", icon: "✗" },
};

const SATISFIER_HINT: Record<string, string> = {
  auto_generated: "Generated for you",
  from_profile: "Filled from your company profile",
  operator_signature: "Prefilled — sign, then mark complete",
  operator_provided: "Only you can supply this",
};

export function SubmissionPackage({
  opportunityId,
  bid,
  kindToPath,
}: {
  opportunityId: string;
  bid: Bid;
  kindToPath: Record<string, string>;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matrix: ResolvedRequirement[] = bid.compliance_matrix ?? [];
  const manifest: PackageItem[] = bid.package_manifest ?? [];
  const validation: PackageValidation | null = bid.validation_json;
  const ready = bid.package_ready;
  const submitted = Boolean(bid.submitted_at);

  async function confirm(reqId: string, confirmed: boolean) {
    setBusyId(reqId);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement_id: reqId, confirmed }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Could not update the requirement.");
      } else {
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function submit(force: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Could not submit.");
      } else {
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Submission package</p>
        <span className="text-sm text-slate-500">margin {pct(bid.margin_pct)}</span>
      </div>
      <div className="num font-serif text-3xl font-semibold text-foreground">
        {currency(bid.bid_amount)}
      </div>

      {/* Validation summary */}
      {validation && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            ready
              ? "border-pursue/40 bg-pursue/5 text-pursue"
              : "border-review/40 bg-review/5 text-slate-700"
          }`}
        >
          <p className="font-medium">
            {ready
              ? `Ready to submit — all ${validation.total_mandatory} required items are in place.`
              : `Not ready yet — ${validation.blockers.length} thing${
                  validation.blockers.length === 1 ? "" : "s"
                } to finish (${validation.satisfied_count}/${validation.total_mandatory} required items done).`}
          </p>
          {validation.blockers.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-review">
              {validation.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {validation.warnings.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-500">
              {validation.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Compliance matrix */}
      {matrix.length > 0 && (
        <div>
          <p className="label mb-2">Requirements ({matrix.length})</p>
          <ul className="divide-y divide-border">
            {matrix.map((r) => {
              const meta = STATUS_META[r.status];
              const needsAction =
                r.status === "needs_signature" || r.status === "needs_operator";
              return (
                <li key={r.id} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">
                        <span className={`mr-1.5 font-semibold ${meta.className}`}>
                          {meta.icon}
                        </span>
                        {r.title}
                        {!r.mandatory && (
                          <span className="ml-1 text-xs text-slate-400">(optional)</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {meta.label}
                        {r.source ? ` · ${r.source}` : ""}
                        {SATISFIER_HINT[r.satisfied_by]
                          ? ` · ${SATISFIER_HINT[r.satisfied_by]}`
                          : ""}
                      </p>
                      {r.instructions && needsAction && (
                        <p className="mt-0.5 text-xs text-review">{r.instructions}</p>
                      )}
                    </div>
                    {!submitted && (needsAction || r.operator_confirmed) && (
                      <button
                        onClick={() => confirm(r.id, !r.operator_confirmed)}
                        disabled={busyId === r.id}
                        className={`shrink-0 text-xs ${
                          r.operator_confirmed
                            ? "text-slate-500 hover:text-slate-700"
                            : "btn-ghost"
                        }`}
                      >
                        {busyId === r.id
                          ? "…"
                          : r.operator_confirmed
                            ? "Reopen"
                            : "Mark complete"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Package manifest */}
      {manifest.length > 0 && (
        <div>
          <p className="label mb-2">Package contents (in order)</p>
          <ul className="divide-y divide-border text-sm">
            {manifest.map((m) => {
              const path = m.document_kind ? kindToPath[m.document_kind] : undefined;
              return (
                <li key={m.order} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-slate-700">
                    <span className="num mr-1.5 text-slate-400">
                      {String(m.order).padStart(2, "0")}
                    </span>
                    {m.filename}
                  </span>
                  {path ? (
                    <a
                      href={`/api/files/${path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-xs text-accent hover:underline"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400">you provide</span>
                  )}
                </li>
              );
            })}
          </ul>
          <a
            href={`/api/opportunities/${opportunityId}/package`}
            className="btn-ghost mt-3 w-full text-center text-xs"
          >
            Download full package (.zip)
          </a>
        </div>
      )}

      {/* QA checklist (secondary) */}
      {bid.qa_checklist && bid.qa_checklist.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">Pricing QA checklist</summary>
          <ul className="mt-1 space-y-1">
            {bid.qa_checklist.map((c: QaChecklistItem, i: number) => (
              <li key={i} className={c.ok ? "text-pursue" : "text-review"}>
                {c.ok ? "✓" : "✗"} {c.item}
                {c.note ? <span className="text-slate-500"> · {c.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="text-sm text-risk whitespace-pre-line">{error}</p>}

      {/* Submit / submitted state */}
      {!submitted && (
        <div className="space-y-2 border-t border-border pt-3">
          <button
            onClick={() => submit(false)}
            disabled={submitting || !ready}
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit bid package"}
          </button>
          {!ready && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "This package hasn't passed all compliance checks. Submit anyway?"
                  )
                )
                  submit(true);
              }}
              disabled={submitting}
              className="w-full text-xs text-slate-500 hover:text-slate-700"
            >
              Submit anyway (override checks)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
