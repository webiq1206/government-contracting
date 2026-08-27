"use client";

/**
 * The decision, and the argument for it.
 *
 * Review is a page whose entire job is a yes or no, and it was a list of
 * cards. A card is a summary; a decision needs the argument, in the order
 * somebody actually makes the call in: what we think, why, what is wrong with
 * it, what we do not know, and how long there is.
 *
 * The controls stay at the foot of the panel rather than travelling with the
 * text, because on a long brief a decision button that scrolls away is a
 * decision somebody defers.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RECOMMENDATION_LABEL,
  type ReviewBrief as Brief,
} from "@/lib/domain/review-brief";
import { shortDate, countdown } from "@/lib/format";
import { SnoozeButton } from "@/components/snooze-button";
import { useToast } from "@/components/toaster";
import { EstimatedValue } from "@/components/estimated-value";

const TONE: Record<string, string> = {
  pursue: "bg-pursue/15 text-pursue",
  pass: "bg-risk/15 text-risk",
  look: "bg-review/15 text-review",
};

export function ReviewBriefPanel({
  opportunityId,
  title,
  subtitle,
  brief,
  canDecide,
  closeHref,
}: {
  opportunityId: string;
  title: string;
  subtitle: string;
  brief: Brief;
  canDecide: boolean;
  closeHref: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passing, setPassing] = useState(false);
  const [reason, setReason] = useState("");

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not work. Nothing was changed.");
        return;
      }
      setPassing(false);
      setReason("");
      /*
       * Undo, on the one action that takes a record off the board.
       *
       * A pass is reversible in the data (it archives rather than deletes) and
       * was irreversible in the interface: the row vanished and the only way
       * back was to know that the closed filter existed. This is the decision
       * screen, so the mistake it invites is passing on the wrong one of two
       * similar notices, and the recovery has to be where the mistake happens.
       */
      if (action === "dismiss") {
        push({
          message: `Passed on "${title}". It is archived, not deleted.`,
          undo: {
            endpoint: `/api/opportunities/${opportunityId}/action`,
            body: { action: "restore" },
          },
        });
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border/55 px-4 py-3 dark:border-white/10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/*
              * The title appears once on this screen. It is already on the
              * card in the queue beside it, and the audit is explicit that a
              * title repeated three times is three chances to read the wrong
              * one.
              */}
            <h2 className="truncate text-base font-medium text-foreground">{title}</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
          </div>
          <Link href={closeHref} className="tap shrink-0 text-sm text-slate-500 hover:text-accent lg:hidden">
            Back
          </Link>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${TONE[brief.recommendation]}`}>
              {RECOMMENDATION_LABEL[brief.recommendation]}
            </span>
            {brief.score != null && (
              <span className="text-sm text-slate-600">
                Fit <span className="num text-foreground">{brief.score}</span> / 100
              </span>
            )}
            {/*
              * A missing confidence is unmeasured, not certain. Rendering
              * nothing here would leave the fit score looking like the whole
              * story on a record nobody ever assessed the readability of.
              */}
            {brief.confidence ? (
              <span className="text-sm text-slate-600">
                Data confidence{" "}
                <span className="num text-foreground">{Math.round(brief.confidence.percent)}</span>{" "}
                / 100 ({brief.confidence.level})
              </span>
            ) : (
              <span className="text-sm text-slate-500">
                Data confidence not measured on this one
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-foreground">{brief.rationale}</p>
        </section>

        {/*
          Two sources stating different facts, above the arguments for and
          against, because a set-aside the notice and the document disagree on
          decides whether the rest of this page is worth reading.
        */}
        {brief.conflicts.length > 0 && (
          <section className="rounded-md border border-risk/40 bg-risk/5 p-3">
            <h3 className="label mb-2 text-risk">The notice and the document disagree</h3>
            <ul className="space-y-3 text-sm">
              {brief.conflicts.map((c) => (
                <li key={c.field}>
                  <p className="font-medium text-foreground">{c.field}</p>
                  <p className="text-muted-foreground">
                    The listing says <span className="text-foreground">{c.fromNotice}</span>. The
                    solicitation says <span className="text-foreground">{c.fromDocument}</span>.
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.matters}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="label mb-2">Contract value</h3>
          {/*
            The figure and where it came from, together. A number with no
            provenance on a decision screen is a number somebody will plan
            against without knowing whether the government published it or an
            AI read it off a page.
          */}
          <EstimatedValue value={brief.value.amount} source={brief.value.source} />
        </section>

        <BriefList
          title="Strongest in its favour"
          items={brief.positives}
          empty="Nothing scored strongly. That is itself an argument."
        />
        <BriefList
          title="Most important against"
          items={brief.risks}
          empty="Nothing was flagged and nothing scored badly."
        />

        <section>
          <h3 className="label mb-2">Not known</h3>
          {brief.missing.length === 0 ? (
            <p className="text-sm text-slate-500">
              {/*
                * Two different states, and they were reading the same. An
                * assessment that found nothing missing is good news; no
                * assessment at all is a gap, and saying "everything was in the
                * notice" about a record nobody checked is exactly the kind of
                * confident wrong answer this pass exists to remove.
                */}
              {brief.confidence
                ? "Everything the scoring needed was in the notice."
                : "Nobody measured how much of this notice could be read, so what is missing is itself unknown."}
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-600">
              {brief.missing.map((m) => (
                <li key={m}>· {m}</li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="label mb-2">Dates</h3>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Government submission deadline
              </dt>
              <dd className={brief.deadline ? "text-foreground" : "text-slate-500"}>
                {brief.deadline
                  ? `${shortDate(brief.deadline)} · ${countdown(brief.deadline)}`
                  : "Not stated in the notice"}
              </dd>
            </div>
            <div>
              {/*
                * A different date about a different thing. Ours, not theirs.
                * Conflating them is how somebody misses a bid because a review
                * timer expired.
                */}
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Dismissed automatically
              </dt>
              <dd className={brief.autoDismissAt ? "text-foreground" : "text-slate-500"}>
                {brief.autoDismissAt
                  ? `${shortDate(brief.autoDismissAt)} · ${countdown(brief.autoDismissAt)}`
                  : "No timer on this one"}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className="label mb-2">What pursuing it costs</h3>
          <ul className="space-y-1 text-sm text-slate-600">
            {brief.effort.map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap gap-2">
          <Link href={`/opportunity/${opportunityId}`} className="btn-ghost inline-flex text-xs">
            Open the full record
          </Link>
          {/* A decision made on a reading should be one click from the thing
              being read. Only links that exist: a notice with no stored URL
              gets no button rather than a dead one. */}
          {brief.sourceLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-ghost inline-flex text-xs"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/55 px-4 py-3 dark:border-white/10">
        {!canDecide ? (
          <p className="text-xs text-slate-500">
            You can read the brief but not decide. An owner, admin, operator or
            estimator can pursue or pass.
          </p>
        ) : passing ? (
          <div className="space-y-2">
            <label htmlFor="pass-reason" className="block text-xs text-slate-600">
              Why are you passing? This is what the scoring learns from.
            </label>
            <textarea
              id="pass-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Too far outside the service area."
              className="input w-full resize-y text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => act("dismiss", { reason })}
                disabled={busy != null || reason.trim().length < 3}
                className="btn-danger text-sm"
              >
                {busy === "dismiss" ? "Passing…" : "Confirm pass"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPassing(false);
                  setError(null);
                }}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act("pursue")}
              disabled={busy != null}
              className="btn-primary text-sm"
            >
              {busy === "pursue" ? "Starting…" : "Pursue"}
            </button>
            <button type="button" onClick={() => setPassing(true)} className="btn-ghost text-sm">
              Pass
            </button>
            <button
              type="button"
              onClick={() => act("rerun")}
              disabled={busy != null}
              className="btn-ghost text-sm"
            >
              {busy === "rerun" ? "Queued…" : "Request more analysis"}
            </button>
            <button
              type="button"
              onClick={() => act("extend_review")}
              disabled={busy != null}
              className="btn-ghost text-sm"
            >
              {busy === "extend_review" ? "Extending…" : "Give it another day"}
            </button>
            {/*
              Snooze and extend are different acts and both belong here.
              Extending moves the automatic-dismissal timer, which is about
              whether this decision may lapse. Snoozing hides the row until a
              chosen time and never touches the timer, which is about when the
              operator wants to see it. Offering only one of them meant
              somebody who wanted to think until Thursday had to spend a day of
              the review window to get it.
            */}
            <SnoozeButton
              kind="opportunity"
              id={opportunityId}
              className="btn-ghost text-sm"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-risk">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function BriefList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { label: string; detail: string }[];
  empty: string;
}) {
  return (
    <section>
      <h3 className="label mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.label}>
              <p className="text-sm text-foreground">{p.label}</p>
              <p className="text-xs text-slate-500">{p.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
