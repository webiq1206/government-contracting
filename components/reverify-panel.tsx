"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SCOPE_LABEL,
  STATE_LABEL,
  VERIFICATION_SCOPES,
  coverageRatio,
  downstreamImpact,
  outcomeSummary,
  partitionFindings,
  type Finding,
  type Recommendation,
  type VerificationScope,
  type VerificationState,
} from "@/lib/domain/reverification";

export interface VerificationView {
  id: string;
  scope: VerificationScope;
  state: VerificationState;
  requestedBy: string;
  queuedAt: string | Date;
  startedAt: string | Date | null;
  finishedAt: string | Date | null;
  fingerprintBefore: string | null;
  fingerprintAfter: string | null;
  coverage: {
    documentsExpected: number;
    documentsVerified: number;
    documentsUnreadable: number;
    pagesProcessed: number;
  } | null;
  findings: Finding[];
  failedScopes: VerificationScope[];
  error: string | null;
  acceptedAt: string | Date | null;
  acceptedBy: string | null;
}

/**
 * Checking a solicitation against its source, and reading what came back.
 *
 * The screen is built around one refusal: it never shows a fresh Verified
 * state for a run that did not read everything. A partial result prints the
 * percentage, a failure says the previous record is unchanged and unproven,
 * and neither is rendered in the colour that means "fine".
 *
 * The old and new values stay side by side through the whole review. A report
 * that shows only what changed, without what it changed from, cannot be
 * checked by the person being asked to accept it.
 */
export function ReverifyPanel({
  opportunityId,
  last,
  live,
  recommendation,
  canRun,
  canAccept,
}: {
  opportunityId: string;
  /** The last run that finished, whatever it concluded. */
  last: VerificationView | null;
  /** A run in flight, when there is one. */
  live: VerificationView | null;
  recommendation: Recommendation;
  canRun: boolean;
  canAccept: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<VerificationScope>(recommendation.scope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/reverify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "The check could not be started.");
      return;
    }
    router.refresh();
  }

  async function act(runId: string, action: "accept" | "cancel") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/opportunities/${opportunityId}/reverify`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, action }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "That could not be recorded.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card scroll-mt-editorial" id="reverify" data-guide-target="reverify">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Checked against the source</p>
        <StateBadge state={live ? live.state : (last?.state ?? "not_verified")} />
      </div>

      <p className="text-sm text-muted-foreground">
        {live
          ? outcomeSummary(live.state, live.coverage ?? emptyCoverage())
          : last
            ? outcomeSummary(last.state, last.coverage ?? emptyCoverage())
            : outcomeSummary("not_verified", emptyCoverage())}
      </p>

      {last && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Line label="Last check" value={when(last.finishedAt)} />
          <Line label="Asked for by" value={last.requestedBy} />
          <Line label="Scope" value={SCOPE_LABEL[last.scope]} />
          <Line
            label="Documents read"
            value={
              last.coverage
                ? `${last.coverage.documentsVerified} of ${last.coverage.documentsExpected}`
                : /* Unknown is not zero: a run that stopped before counting has
                     not established that there are no documents. */
                  "Not counted"
            }
          />
          <Line label="Fingerprint before" value={short(last.fingerprintBefore)} />
          <Line label="Fingerprint now" value={short(last.fingerprintAfter)} />
        </dl>
      )}

      {last?.failedScopes.length ? (
        <p className="mt-2 rounded-md bg-risk/10 px-3 py-2 text-xs text-risk">
          Did not complete: {last.failedScopes.map((s) => SCOPE_LABEL[s]).join(", ")}.
          {last.error ? ` ${last.error}` : ""}
        </p>
      ) : null}

      {live ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {SCOPE_LABEL[live.scope]} is {live.state === "queued" ? "queued" : "running"}.
          </p>
          {canRun && live.state === "queued" && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => void act(live.id, "cancel")}
              disabled={busy}
            >
              Cancel it
            </button>
          )}
        </div>
      ) : (
        canRun && (
          <div className="mt-4 space-y-2">
            <label className="block">
              <span className="label">What to check</span>
              <select
                className="input w-full sm:w-auto"
                value={scope}
                onChange={(e) => setScope(e.target.value as VerificationScope)}
              >
                {VERIFICATION_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <p className={`text-xs ${recommendation.urgent ? "text-risk" : "text-muted-foreground"}`}>
              {recommendation.because}
            </p>
            <button type="button" className="btn-primary" onClick={() => void start()} disabled={busy}>
              {busy ? "Starting" : SCOPE_LABEL[scope]}
            </button>
          </div>
        )
      )}

      {error && <p className="mt-2 text-sm text-risk">{error}</p>}

      {last && last.findings.length > 0 && (
        <Report run={last} canAccept={canAccept} busy={busy} onAccept={() => void act(last.id, "accept")} />
      )}
    </div>
  );
}

function emptyCoverage() {
  return {
    documentsExpected: 0,
    documentsVerified: 0,
    documentsUnreadable: 0,
    pagesProcessed: 0,
  };
}

function Report({
  run,
  canAccept,
  busy,
  onAccept,
}: {
  run: VerificationView;
  canAccept: boolean;
  busy: boolean;
  onAccept: () => void;
}) {
  const { automatic, needsReview } = partitionFindings(run.findings);
  const impact = downstreamImpact(run.findings);
  const unchanged = run.findings.filter((f) => f.kind === "unchanged").length;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="label mb-2">What the check found</p>

      {needsReview.length === 0 && automatic.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing differs. <span className="num">{unchanged}</span> item
          {unchanged === 1 ? "" : "s"} matched the source.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">What</th>
                <th className="py-2 pr-3 font-medium">On file</th>
                <th className="py-2 pr-3 font-medium">At the source</th>
                <th className="py-2 font-medium">Where</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...needsReview, ...automatic].map((f, i) => (
                <tr key={`${f.subject}-${i}`} className="align-top">
                  <td className="py-2 pr-3">
                    <p
                      className={`font-medium ${
                        f.impact === "blocking" ? "text-risk" : "text-foreground"
                      }`}
                    >
                      {f.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {SCOPE_LABEL[f.scope]} · {f.kind}
                    </p>
                    {f.note && <p className="mt-1 text-xs text-muted-foreground">{f.note}</p>}
                  </td>
                  {/* Both sides, all the way through the review. A report that
                      shows only what changed cannot be checked by the person
                      being asked to accept it. */}
                  <td className="py-2 pr-3 text-muted-foreground">{f.before ?? "Nothing"}</td>
                  <td className="py-2 pr-3 text-foreground">{f.after ?? "No longer published"}</td>
                  <td className="py-2 text-xs text-muted-foreground">{f.citation ?? "Not cited"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="mt-3 space-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {impact.lines.map((l, i) => (
          <li key={i} className={i === 0 && impact.deadlineEarlier ? "text-risk" : ""}>
            {l}
          </li>
        ))}
      </ul>

      {run.acceptedAt ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Accepted by {run.acceptedBy} on {when(run.acceptedAt)}.
        </p>
      ) : (
        canAccept &&
        needsReview.length > 0 && (
          <button type="button" className="btn-primary mt-3 text-xs" onClick={onAccept} disabled={busy}>
            Accept what this found
          </button>
        )
      )}
    </div>
  );
}

function StateBadge({ state }: { state: VerificationState }) {
  const tone =
    state === "verified_no_changes"
      ? "bg-pursue/10 text-pursue"
      : state === "failed" || state === "conflicts_found"
        ? "bg-risk/15 text-risk"
        : state === "changes_found" || state === "partially_verified" || state === "stale"
          ? "bg-review/15 text-review"
          : "bg-muted text-muted-foreground";
  return <span className={`badge ${tone}`}>{STATE_LABEL[state]}</span>;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function when(d: string | Date | null): string {
  if (!d) return "Never";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function short(hash: string | null): string {
  return hash ? hash.slice(0, 12) : "Not recorded";
}

/** Exported so the coverage arithmetic is asserted where it is rendered. */
export { coverageRatio };
