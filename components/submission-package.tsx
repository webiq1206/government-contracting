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
  AuditFinding,
} from "@/lib/types";
import { currency, pct, timeAgo } from "@/lib/format";
import { ThemeWordmark } from "@/components/theme-wordmark";

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
  operator_signature: "Prefilled, sign, then mark complete",
  operator_provided: "Only you can supply this",
};

export function SubmissionPackage({
  opportunityId,
  bid,
  kindToPath,
  submissionMethod,
  contact,
  solicitationNumber,
  opportunityTitle,
}: {
  opportunityId: string;
  bid: Bid;
  kindToPath: Record<string, string>;
  /** How the agency wants the bid delivered (from the solicitation analysis). */
  submissionMethod?: string | null;
  /** The contracting officer from the notice. */
  contact?: { name?: string; email?: string; phone?: string } | null;
  solicitationNumber?: string | null;
  opportunityTitle?: string | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matrix: ResolvedRequirement[] = bid.compliance_matrix ?? [];
  const manifest: PackageItem[] = bid.package_manifest ?? [];
  const validation: PackageValidation | null = bid.validation_json;
  const findings: AuditFinding[] = bid.audit_findings ?? [];
  const auditStatus = bid.audit_status;
  const ready = bid.package_ready;
  const submitted = Boolean(bid.submitted_at);
  const blockers = validation?.blockers ?? [];
  const tradeBlockers = blockers.filter((b) => /pricing has not been received/i.test(b));
  const otherBlockers = blockers.filter((b) => !/pricing has not been received/i.test(b));
  const canForceOverride = !ready && tradeBlockers.length === 0;

  async function post(payload: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Could not update.");
      } else {
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }
  const confirm = (reqId: string, confirmed: boolean) =>
    post({ requirement_id: reqId, confirmed }, reqId);
  const acknowledge = (findingId: string, confirmed: boolean) =>
    post({ finding_id: findingId, confirmed }, findingId);

  const SEV_META: Record<AuditFinding["severity"], { className: string; label: string }> = {
    blocker: { className: "text-risk", label: "Must fix" },
    warning: { className: "text-review", label: "Review" },
    info: { className: "text-slate-500", label: "Note" },
  };

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

  const readyPct =
    validation && validation.total_mandatory > 0
      ? Math.round(
          (validation.satisfied_count / validation.total_mandatory) * 100
        )
      : ready
        ? 100
        : 0;
  const readinessRows = [
    {
      title: "Pricing rollup",
      detail:
        bid.bid_amount != null
          ? `Bid ${currency(bid.bid_amount)} · margin ${pct(bid.margin_pct)}`
          : "Margin and quote checks",
      ok: bid.bid_amount != null && bid.bid_amount > 0,
    },
    {
      title: "Required forms",
      detail:
        validation != null
          ? `${validation.satisfied_count}/${validation.total_mandatory} required items done`
          : "Compliance matrix",
      ok: Boolean(ready || (validation && validation.blockers.length === 0)),
    },
    {
      title: "Certifications",
      detail:
        findings.filter((f) => f.severity === "blocker" && !f.acknowledged).length === 0
          ? "No open blocker findings"
          : "Open audit blockers remain",
      ok: findings.filter((f) => f.severity === "blocker" && !f.acknowledged).length === 0,
    },
    {
      title: "Compliance review",
      detail: ready
        ? "No open exceptions"
        : blockers.length > 0
          ? `${blockers.length} item${blockers.length === 1 ? "" : "s"} to finish`
          : "In progress",
      ok: Boolean(ready),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border/55 bg-surface px-6 py-7 shadow-sm dark:border-white/10">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Bid package · {submitted ? "Submitted" : "Final review"}
          </p>
          <div className="mt-5 h-px w-full bg-border/55 dark:bg-white/10" />
          <div className="mt-5">
            <ThemeWordmark className="h-6" />
          </div>
          <h3 className="mt-6 font-display text-2xl leading-snug text-foreground sm:text-3xl">
            {opportunityTitle ?? "Bid proposal"}
          </h3>
          {solicitationNumber && (
            <p className="mt-2 text-sm text-muted-foreground">{solicitationNumber}</p>
          )}
          <div className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Solicitation</p>
              <p className="mt-0.5 text-foreground">
                {solicitationNumber ?? "See bid brief"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Priced amount</p>
              <p className="num mt-0.5 text-foreground">{currency(bid.bid_amount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Margin</p>
              <p className="num mt-0.5 text-foreground">{pct(bid.margin_pct)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="mt-0.5 text-foreground">
                {submitted
                  ? `Submitted ${timeAgo(bid.submitted_at)}`
                  : ready
                    ? "Ready for approval"
                    : "In assembly"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/55 bg-surface px-6 py-7 text-foreground dark:border-white/10 dark:bg-shell">
          <p className="eyebrow-gold">Package checklist</p>
          <p className="mt-3 font-display text-4xl text-gold">
            <span className="num">{readyPct}%</span>
          </p>
          <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
            {ready
              ? "Ready for your approval"
              : submitted
                ? "Submitted"
                : "Finish items below"}
          </p>
          <ul className="mt-6 divide-y divide-border/55 dark:divide-white/10">
            {readinessRows.map((row) => (
              <li key={row.title} className="flex items-start gap-3 py-3">
                <span
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] ${
                    row.ok
                      ? "border-pursue/50 text-pursue"
                      : "border-border-strong/40 text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {row.ok ? "✓" : "·"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{row.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          {manifest.length > 0 && (
            <a
              href={`/api/opportunities/${opportunityId}/package`}
              className="btn-primary mt-6 flex w-full items-center justify-center gap-2 uppercase tracking-[0.08em]"
            >
              Open final package
              <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      </div>

      <div className="card space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow-gold">Submission package details</p>
        <span className="text-sm text-slate-500">margin {pct(bid.margin_pct)}</span>
      </div>
      <div className="num font-display text-3xl font-normal text-foreground">
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
              ? `Ready to submit, all ${validation.total_mandatory} required items are in place.`
              : `Not ready yet, ${validation.blockers.length} thing${
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

      {/* Independent compliance audit */}
      {auditStatus === "pending" && (
        <p className="text-xs text-slate-500">
          Independent compliance audit is running, it re-reads the solicitation
          against this package and will flag anything missing or non-compliant.
        </p>
      )}
      {auditStatus === "skipped" && (
        <p className="text-xs text-slate-500">
          The AI compliance audit could not run (no solicitation text or the AI
          key is not set). Eligibility checks above still apply; give the
          package one careful human read against the solicitation before
          submitting.
        </p>
      )}
      {auditStatus === "clean" && findings.length === 0 && (
        <p className="text-xs text-pursue">
          ✓ Independent compliance audit found no issues. Still worth a final
          human cross-check against the solicitation.
        </p>
      )}
      {findings.length > 0 && (
        <div>
          <p className="label mb-2">
            Compliance audit ({findings.filter((f) => !f.acknowledged).length} open)
          </p>
          <ul className="space-y-2">
            {findings.map((f) => {
              const sev = SEV_META[f.severity];
              return (
                <li
                  key={f.id}
                  className={`rounded-md border px-3 py-2 ${
                    f.acknowledged
                      ? "border-border bg-surface opacity-60"
                      : f.severity === "blocker"
                        ? "border-risk/40 bg-risk/5"
                        : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">
                        <span className={`mr-1.5 text-xs font-semibold uppercase ${sev.className}`}>
                          {sev.label}
                        </span>
                        {f.finding}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">→ {f.recommendation}</p>
                    </div>
                    {!submitted && (
                      <button
                        onClick={() => acknowledge(f.id, !f.acknowledged)}
                        disabled={busyId === f.id}
                        className={`shrink-0 text-xs ${
                          f.acknowledged ? "text-slate-500 hover:text-slate-700" : "btn-ghost"
                        }`}
                      >
                        {busyId === f.id ? "…" : f.acknowledged ? "Reopen" : "Resolved"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
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
                          <span className="ml-1 text-xs text-slate-500">(optional)</span>
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
                      {r.official_form_doc && (
                        <a
                          href={`/api/files/${r.official_form_doc.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block text-xs text-accent hover:underline"
                        >
                          Open the agency&rsquo;s form to sign →
                        </a>
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
              const path =
                m.document_path ?? (m.document_kind ? kindToPath[m.document_kind] : undefined);
              return (
                <li key={m.order} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-slate-700">
                    <span className="num mr-1.5 text-slate-500">
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
                    <span className="shrink-0 text-xs text-slate-500">you provide</span>
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

      {/* Exactly how to send it, no guessing at the last step. */}
      {ready && !submitted && (
        <div className="rounded-md border border-pursue/30 bg-pursue/5 px-4 py-3 text-sm">
          <p className="label mb-1.5 text-pursue">When you&rsquo;re ready to send</p>
          <ol className="list-decimal space-y-1 pl-5 text-slate-800">
            <li>Download the full package (.zip) above and unzip it.</li>
            <li>
              {contact?.email ? (
                <>
                  Email every file to{" "}
                  <span className="font-medium">
                    {contact.name ? `${contact.name}, ` : ""}
                    {contact.email}
                  </span>
                  {" · "}
                  <a
                    className="text-accent-strong underline"
                    href={`mailto:${contact.email}?subject=${encodeURIComponent(
                      `Quote Submission${solicitationNumber ? `, ${solicitationNumber}` : ""}${opportunityTitle ? `, ${opportunityTitle}` : ""}`
                    )}&body=${encodeURIComponent(
                      "Good morning,\n\nPlease find our quote attached for the referenced solicitation. All required documents are included.\n\nWe appreciate your consideration and are available for any questions.\n\n[Your name]\n[Your company]\n[Your phone]"
                    )}`}
                  >
                    open a pre-written email
                  </a>{" "}
                  <span className="text-slate-500">(attach the unzipped files before sending)</span>
                </>
              ) : submissionMethod ? (
                <>
                  Deliver it the way the solicitation asks:{" "}
                  <span className="font-medium">{submissionMethod}</span>
                </>
              ) : (
                <>Deliver it per the solicitation&rsquo;s instructions (see the Bid Brief).</>
              )}
              {contact?.phone && (
                <span className="text-slate-500"> · questions: {contact.phone}</span>
              )}
            </li>
            <li>
              Come back and press <span className="font-medium">Submit bid package</span>{" "}
              below so the platform starts tracking the award.
            </li>
          </ol>
        </div>
      )}

      {/* Submit / submitted state */}
      {!submitted && (
        <div className="space-y-2 border-t border-border pt-3">
          {!ready && blockers.length > 0 && (
            <div className="rounded-md border border-risk/40 bg-risk/5 px-3 py-3 text-sm">
              <p className="font-semibold text-slate-900">Bid cannot be submitted</p>
              <p className="mt-1 text-xs text-slate-600">
                Resolve every item below. Missing trade pricing cannot be overridden.
              </p>
              <ul className="mt-2 space-y-1.5">
                {blockers.map((b) => (
                  <li key={b} className="flex flex-wrap items-start justify-between gap-2">
                    <span className="text-slate-800">• {b}</span>
                    {/pricing has not been received/i.test(b) ? (
                      <a href="#coverage" className="text-xs font-medium text-accent hover:underline">
                        Open required pricing
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500">Clear in checklist above</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => submit(false)}
            disabled={submitting || !ready}
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit bid package"}
          </button>
          {canForceOverride && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "This package has outstanding compliance checks (not trade pricing). Submit anyway?"
                  )
                )
                  submit(true);
              }}
              disabled={submitting}
              className="w-full text-xs text-slate-500 hover:text-slate-700"
            >
              Submit anyway (override non-trade checks)
            </button>
          )}
          {tradeBlockers.length > 0 && otherBlockers.length === 0 && (
            <p className="text-center text-xs text-slate-500">
              Override is disabled until every required trade has pricing.
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
