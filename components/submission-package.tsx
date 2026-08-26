"use client";
import { overrideProblem, OVERRIDE_PROBLEM_MESSAGE } from "@/lib/domain/override";
import { assessReadiness } from "@/lib/domain/submission-readiness";
import { MarkAsSent } from "@/components/mark-as-sent";
import { ReceiptStatusCard } from "@/components/receipt-status-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { parseSubmissionState } from "@/lib/domain/submission-state";

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
import { auditNotice, packageChecklist } from "@/lib/domain/package";
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
  proofOptions = [],
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
  /** Documents on this opportunity that could serve as the send receipt. */
  proofOptions?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingApproval, setConfirmingApproval] = useState(false);

  const matrix: ResolvedRequirement[] = bid.compliance_matrix ?? [];
  const manifest: PackageItem[] = bid.package_manifest ?? [];
  const validation: PackageValidation | null = bid.validation_json;
  const findings: AuditFinding[] = bid.audit_findings ?? [];
  /*
   * One sentence about the audit, decided in the domain rather than by four
   * conditions here. The case that used to be missing is a skipped run
   * carrying blockers forward: three separate `auditStatus === ...` lines
   * could not express "today's run did not happen and what you are reading is
   * from last Tuesday", so the page said only that the audit could not run and
   * left the findings looking current.
   */
  const notice = auditNotice({
    status: bid.audit_status,
    ranAt: bid.audit_ran_at,
    findings,
    formatDate: (d) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  });
  const ready = bid.package_ready;
  /*
   * Three states where there used to be two.
   *
   * `submitted_at` was set by pressing a button on a screen that does not send
   * anything, so it recorded an intention. Approving a package and delivering
   * one are different acts by different parties, and the screen has to be able
   * to say which has happened.
   */
  const submissionState = bid.submission_state ?? (bid.submitted_at ? "sent" : "package_ready");
  const approved = submissionState === "approved";
  const submitted = Boolean(bid.submitted_at) || submissionState === "sent";
  const blockers = validation?.blockers ?? [];
  const tradeBlockers = blockers.filter((b) => /pricing has not been received/i.test(b));
  const otherBlockers = blockers.filter((b) => !/pricing has not been received/i.test(b));
  /*
   * The override mirrors what the server will actually accept, exactly.
   *
   * It used to appear whenever the only outstanding items were non-trade,
   * which included a missing mandatory form. The server refuses those now, so
   * the button would be a control that always fails: the operator presses it,
   * confirms a dialog warning them it is risky, and gets a 409. A button that
   * cannot work is worse than no button, because pressing it is how somebody
   * finds out.
   *
   * What survives is the one case the server still allows: nothing is
   * outstanding and the compliance audit simply has not confirmed the
   * package, which usually means it could not run. That is a human gate, and
   * a person clicking through it is the gate working.
   */
  const openAuditBlockers = findings.filter((f) => f.severity === "blocker" && !f.acknowledged);
  const canForceOverride = !ready && blockers.length === 0 && openAuditBlockers.length === 0;
  /*
   * How much assurance actually stands behind this package.
   *
   * Five separate facts rather than one boolean, because "the files are all
   * there" and "something read the solicitation back" are different
   * assurances and only the second catches a package assembled correctly
   * against the wrong requirements.
   */
  const readiness = assessReadiness({
    mechanicallyComplete: Boolean(bid.package_ready),
    blockerCount: blockers.length,
    auditStatus: bid.audit_status,
    openAuditBlockers: openAuditBlockers.length,
    // No sign-off column yet, so nobody has verified anything by hand.
    verifiedBy: null,
    submissionState,
    // Not yet a per-account setting. Left off so the only thing that turns it
    // on is the audit being unavailable, which is the case the instructions
    // name and the one that actually matters.
    humanGateRequired: false,
  });

  /*
   * Everything standing between this package and submission: the deterministic
   * blockers and the unresolved audit blockers, which are two different lists
   * gating the same button.
   */
  const outstanding =
    blockers.length + findings.filter((f) => f.severity === "blocker" && !f.acknowledged).length;

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

  /**
   * Attach the operator's own file to a requirement.
   *
   * "Mark complete" alone is a promise about a document that lives somewhere
   * else: the submission archive is built from the manifest, so a bid bond or
   * a signed offer form that was never attached here is simply not in the zip
   * the operator downloads and sends. Uploading against the requirement puts
   * the real file in the package.
   */
  async function attach(reqId: string, file: File) {
    setBusyId(reqId);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("requirement_id", reqId);
      body.append("kind", "requirement_document");
      const res = await fetch(`/api/opportunities/${opportunityId}/documents`, {
        method: "POST",
        body,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? "Could not upload that file.");
      else if (d.requirement_error) setError(d.requirement_error);
      else router.refresh();
    } finally {
      setBusyId(null);
    }
  }
  const acknowledge = (findingId: string, confirmed: boolean) =>
    post({ finding_id: findingId, confirmed }, findingId);

  const SEV_META: Record<AuditFinding["severity"], { className: string; label: string }> = {
    blocker: { className: "text-risk", label: "Must fix" },
    warning: { className: "text-review", label: "Review" },
    info: { className: "text-slate-500", label: "Note" },
  };

  /**
   * Approve the package, optionally overriding one named warning.
   *
   * `force: true` used to be the whole story: a boolean that got a package
   * past the lead-hours rule with nothing recorded about which warning was
   * waved or why. An override is a decision somebody may be asked to defend
   * six weeks later, so it carries the warning it applies to and a sentence
   * in the operator's own words.
   */
  async function submit(override?: { requirement: string; reason: string }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(override ? { override } : {}),
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

  /*
   * Rows and percentage from one place, so the headline cannot answer a
   * different question from the list under it.
   */
  const { rows: readinessRows, percent: readyPct } = packageChecklist({
    bidAmount: bid.bid_amount,
    bidText: currency(bid.bid_amount),
    marginText: pct(bid.margin_pct),
    validation,
    findings,
    ready,
    outstanding,
    auditStatus: bid.audit_status,
  });

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
          <p className="mt-3 font-display text-4xl text-gold-text">
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
          {/*
            The headline is never stronger than the weakest assurance behind
            it. This used to read "Ready to submit, all 14 required items are
            in place" whenever the MECHANICAL checks passed, which is true and
            is not the whole truth: the compliance audit is a separate pass, it
            can be skipped, and when it is, nothing has read the solicitation
            back against the package. The audit notice saying so sat further
            down the page. Two true statements, one of which is the one people
            read.
          */}
          <p className="font-medium">
            {ready
              ? readiness.headline
              : /*
                 * Counts everything that holds the package back, not just the
                 * deterministic half. Readiness is validation AND no open audit
                 * blocker, so counting only `validation.blockers` produced
                 * "Not ready yet, 0 things to finish" whenever the thing to
                 * finish was an audit finding. A zero beside a refusal reads
                 * as a bug in the product rather than as work to do, and it
                 * sends somebody looking in the wrong place.
                 */
                `Not ready yet, ${outstanding} thing${
                  outstanding === 1 ? "" : "s"
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
      {notice && (
        <div
          className={
            notice.tone === "warn"
              ? "rounded-md border border-review/40 bg-review/10 px-3 py-2"
              : "rounded-md border border-border bg-surface px-3 py-2"
          }
          /*
           * A run that did not happen used to be 11px grey text under a
           * package marked ready. It is the one thing on this panel that
           * changes what a careful person does next, so it is bordered rather
           * than whispered.
           *
           * No role="status": this is rendered with the page rather than
           * announced on a change, and a live region that never changes is
           * either read out of order or not at all.
           */
        >
          <p
            className={`text-xs font-medium ${
              notice.tone === "warn" ? "text-review" : "text-foreground"
            }`}
          >
            {/* Colour is never the only signal. */}
            {notice.tone === "warn" ? "\u25b2 " : ""}
            {notice.headline}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{notice.detail}</p>
        </div>
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
                      {/*
                        The note is where the resolver explains what to do and
                        why: that the agency prices on its own schedule of four
                        lines, that an uploaded volume is twelve pages against a
                        ten page limit, that another requirement already claimed
                        the generated document. None of it was ever rendered, so
                        the operator saw a status and no reason for it.
                      */}
                      {r.note && <p className="mt-0.5 text-xs text-review">{r.note}</p>}
                      {r.instructions && needsAction && r.instructions !== r.note && (
                        <p className="mt-0.5 text-xs text-slate-500">{r.instructions}</p>
                      )}
                      {r.format && (
                        <p className="mt-0.5 text-xs text-review">
                          The solicitation&rsquo;s rule for this item: {r.format}
                        </p>
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
                      {r.operator_doc && (
                        <a
                          href={`/api/files/${r.operator_doc.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 block text-xs text-accent hover:underline"
                        >
                          In the package: {r.operator_doc.name} →
                        </a>
                      )}
                    </div>
                    {!submitted && (needsAction || r.operator_confirmed) && (
                      <div className="flex shrink-0 items-center gap-3">
                        <label
                          className={`cursor-pointer text-xs ${
                            busyId === r.id ? "text-slate-500" : "text-accent hover:underline"
                          }`}
                        >
                          {r.operator_doc ? "Replace file" : "Attach file"}
                          <input
                            type="file"
                            className="hidden"
                            disabled={busyId === r.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) void attach(r.id, f);
                            }}
                          />
                        </label>
                        <button
                          onClick={() => confirm(r.id, !r.operator_confirmed)}
                          disabled={busyId === r.id}
                          className={`text-xs ${
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
                      </div>
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

      {/*
        What is proven about the send, kept on the screen.
        "Sent" is the state that quietly loses bids: a rejected upload and a
        successful one look identical from inside this product, and the
        difference surfaces when the award goes to somebody else. So the card
        stays while the acknowledgement is outstanding rather than a status
        word appearing once and the question closing.
      */}
      <ReceiptStatusCard
        state={parseSubmissionState(submissionState)}
        sentAt={bid.submitted_at ? new Date(bid.submitted_at) : null}
        method={bid.submission_method ?? null}
        destination={bid.submission_destination ?? null}
        timezone={bid.sent_timezone ?? null}
        confirmationNumber={bid.confirmation_number ?? null}
        proofName={proofOptions.find((p) => p.id === bid.proof_document_id)?.name ?? null}
      />

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
          {/*
            * Confirmed, and the confirmation says what the press actually
            * does. This records a delivery; it does not make one. The steps
            * above explain that, but somebody who scrolled straight here gets
            * an irreversible-looking button with no restatement, and a bid
            * marked delivered that nobody uploaded is the product asserting
            * something that did not happen.
            *
            * The override path below has always confirmed. The ordinary one,
            * which is the one everybody uses, did not.
            */}
          {/*
            Approving is not sending, and the button no longer pretends
            otherwise. It used to say "Submit bid package" and set
            `submitted_at`, on a screen that cannot submit anything: the
            delivery is a person uploading files to a government portal in
            another application. Pressing this clears the package; the form
            underneath records what actually happened.
          */}
          {!approved && (
            <>
              <ConfirmDialog
                open={confirmingApproval}
                title="Approve this package?"
                body={
                  <>
                    <p>It will be cleared to send.</p>
                    <p className="mt-2">
                      Brost Co does not deliver it. You send it the way the solicitation asks,
                      then record how and when, and only that counts as submitted.
                    </p>
                  </>
                }
                confirmLabel="Approve it"
                busy={submitting}
                onConfirm={() => {
                  setConfirmingApproval(false);
                  submit();
                }}
                onCancel={() => setConfirmingApproval(false)}
              />
              <button
                onClick={() => setConfirmingApproval(true)}
                disabled={submitting || !ready}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Approving" : "Approve this package"}
              </button>
            </>
          )}
          {approved && (
            <MarkAsSent
              opportunityId={opportunityId}
              proofOptions={proofOptions}
              onUploadHref="#attachments"
            />
          )}
          {/*
            An override asks for a sentence, not a click.
            `window.confirm` collected agreement and recorded nothing: the log
            said somebody submitted, and which warning they waved, and why,
            existed nowhere. An operator with a genuine reason types it in a
            few seconds; the point is that it is written down.
          */}
          {canForceOverride && (
            <OverrideForm
              requirement="Approving without a compliance audit confirming the package"
              busy={submitting}
              onConfirm={(reason) =>
                submit({
                  requirement: "Approving without a compliance audit confirming the package",
                  reason,
                })
              }
            />
          )}
          {/*
            Why there is no override, when there is not one.
            This used to fire only for missing trade pricing, so an operator
            blocked by a missing mandatory form saw the button vanish with no
            explanation at all. It now covers every reason the server refuses.
          */}
          {!ready && !canForceOverride && (
            <p className="text-center text-xs text-slate-500">
              {tradeBlockers.length > 0 && otherBlockers.length === 0
                ? "There is no override while a required trade has no pricing."
                : openAuditBlockers.length > 0 && blockers.length === 0
                  ? "There is no override while the audit has open blockers. Acknowledge each one above, against your name, or resolve it."
                  : "There is no override while anything above is outstanding. Clear the items listed, then submit."}
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Ask for the reason before waving a warning through.
 *
 * Deliberately not a dialog. A dialog is dismissed; a field that has to be
 * filled in is a moment where somebody decides what they actually believe, and
 * that sentence is the whole value of the record.
 */
function OverrideForm({
  requirement,
  busy,
  onConfirm,
}: {
  requirement: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const problem = overrideProblem({ requirement, reason });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-xs text-slate-500 hover:text-slate-700"
      >
        Approve without audit confirmation
      </button>
    );
  }

  return (
    <form
      className="rounded-md border border-review/40 bg-review/5 px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onConfirm(reason.trim());
      }}
    >
      <p className="text-sm font-medium text-slate-900">{requirement}</p>
      <label className="mt-2 block text-xs text-muted-foreground" htmlFor="override-reason">
        What do you know that the check does not? This goes on the record with your
        name against it.
      </label>
      <textarea
        id="override-reason"
        className="input mt-1 w-full text-sm"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Read the package against Sections L and M myself; every listed item is present."
        required
      />
      {/*
        The specific objection, not a disabled button with no explanation.
        Shown only once somebody has typed something, so it reads as feedback
        rather than as a telling-off before they started.
      */}
      {problem && reason.trim().length > 0 && (
        <p className="mt-1 text-xs text-review">{OVERRIDE_PROBLEM_MESSAGE[problem]}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button type="submit" className="btn-secondary text-xs" disabled={busy || Boolean(problem)}>
          {busy ? "Approving" : "Approve anyway"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
