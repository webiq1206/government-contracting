import Link from "next/link";
import { WorkspacePane } from "@/components/workspace/workspace-shell";
import { ReviewBriefPanel } from "@/components/review-brief";
import { CallPanel } from "@/components/call-panel";
import { QuoteEntryForm } from "@/components/quote-entry-form";
import { SubmissionPackage } from "@/components/submission-package";
import { AdvanceAction, SkipAction } from "@/components/workspace/advance-action";
import { SnoozeButton } from "@/components/snooze-button";
import { ReplyOutcomeGuide, ReplyOutcomes } from "@/components/workbench/reply-pane";
import { EstimatedValue } from "@/components/estimated-value";
import { briefFor, briefSubtitle } from "@/lib/review-brief";
import { flagLabel } from "@/lib/flag-labels";
import { PANE_INTENT, PANE_TITLE, paneFor } from "@/lib/domain/workbench";
import { quoteSubOptions, recordedQuotes, tradeState } from "@/lib/workbench";
import type { WorkbenchDetail } from "@/lib/workbench";
import type { WorkItem } from "@/lib/domain/work-queue";
import { currency, shortDate } from "@/lib/format";
import type { Bid, SolicitationAnalysis } from "@/lib/types";

/**
 * The middle pane: whatever this particular task needs, and the controls that
 * finish it.
 *
 * A dispatch rather than a generic form, because the six kinds of work are not
 * variations on one shape. A decision needs an argument; a reply needs the
 * subcontractor's own words; a bid needs the assembled package and a
 * signature. Pretending they are the same thing is how a generic queue ends up
 * being a list of links to real screens, which is what this replaces.
 *
 * Every branch ends the same way: a foot with the action that completes the
 * item, and the item after it already worked out.
 */
export function WorkbenchPanel({
  item,
  detail,
  nextHref,
  doneHref,
  canDecide,
  canOutreach,
  canSubmit,
  position,
}: {
  item: WorkItem;
  detail: WorkbenchDetail;
  nextHref: string | null;
  doneHref: string;
  canDecide: boolean;
  canOutreach: boolean;
  canSubmit: boolean;
  position: { index: number; total: number };
}) {
  const pane = paneFor(item);

  if (detail.pane === "gone") {
    return (
      <WorkspacePane header={<PaneHeader item={item} position={position} backHref={doneHref} />}>
        <div className="rounded-md border border-border/60 p-4 dark:border-white/10">
          <p className="text-sm font-medium text-foreground">{detail.why}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing was changed. This happens on a shared account when somebody
            else gets to an item first, and the queue beside this will be right
            again on the next load.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SkipAction
              nextHref={nextHref}
              doneHref={doneHref}
              label={nextHref ? "Next item" : "Back to the queue"}
              className="btn-primary text-sm"
            />
            <Link href={item.recordHref} className="btn-ghost text-sm">
              Open the record anyway
            </Link>
          </div>
        </div>
      </WorkspacePane>
    );
  }

  /*
   * The decision brief owns its own header and foot, because it is the same
   * panel the Review page renders and the two must not drift. Everything it
   * needed to also serve here was a next item and a way back.
   */
  if (detail.pane === "decide") {
    const opp = detail.opportunity.opp;
    return (
      <ReviewBriefPanel
        opportunityId={String(opp.id)}
        title={opp.title ?? "Untitled opportunity"}
        subtitle={briefSubtitle(opp)}
        brief={briefFor(opp)}
        canDecide={canDecide}
        closeHref={doneHref}
        nextHref={nextHref}
        recordHref={item.recordHref}
      />
    );
  }

  /*
   * The call workspace owns its own screen too, and already knew how to fetch
   * itself and close. Handing it the next item as its "close" is what turns
   * eight calls into eight calls rather than eight calls and eight journeys
   * back to the list.
   */
  if (detail.pane === "call") {
    return <CallPanel cardId={detail.cardId} closeHref={nextHref ?? doneHref} />;
  }

  if (detail.pane === "reply") {
    const r = detail.reply;
    return (
      <WorkspacePane
        header={<PaneHeader item={item} position={position} backHref={doneHref} />}
        footer={
          <div className="space-y-2">
            <ReplyOutcomes
              replyId={r.id}
              nextHref={nextHref}
              doneHref={doneHref}
              canAct={canOutreach}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <SkipAction nextHref={nextHref} doneHref={doneHref} label="Skip for now" />
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <Facts
            rows={[
              { label: "Firm", value: r.companyName ?? "Unnamed firm" },
              { label: "Trade", value: r.trade ?? "Not stated" },
              {
                label: "Solicitation",
                value: r.opportunityTitle ?? "Not filed against a bid",
              },
              { label: "Arrived", value: r.receivedAt ? shortDate(r.receivedAt) : "Unknown" },
            ]}
          />

          {r.reviewReason && (
            <section className="rounded-md border border-review/40 bg-review/5 p-3">
              <h3 className="label mb-1 text-review">Why the reader stopped</h3>
              <p className="text-sm text-foreground">{r.reviewReason}</p>
              {r.intent && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Its best guess was &ldquo;{r.intent}&rdquo;
                  {r.confidence ? `, at ${r.confidence} confidence` : ""}. Nothing was
                  recorded from it.
                </p>
              )}
            </section>
          )}

          <section>
            <h3 className="label mb-2">What they wrote</h3>
            {r.originalMessage ? (
              /*
               * The whole message, never an excerpt.
               *
               * The list this replaces cut it at 240 characters behind a "read
               * the whole message" toggle, which is the wrong default on a
               * screen whose entire purpose is that the machine's reading of
               * these words could not be trusted.
               */
              <blockquote className="whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-foreground/80">
                {r.originalMessage}
              </blockquote>
            ) : (
              <p className="text-sm text-muted-foreground">
                The message body was not stored. Open the thread to read it.
              </p>
            )}
          </section>

          <section>
            <h3 className="label mb-2">What each answer does</h3>
            <ReplyOutcomeGuide />
          </section>

          <div className="flex flex-wrap gap-2">
            {r.subcontractorId && (
              <Link
                href={`/subs/${r.subcontractorId}#conversations`}
                className="btn-ghost text-xs"
              >
                Read the thread and reply
              </Link>
            )}
            {r.opportunityId && (
              <Link href={`/opportunity/${r.opportunityId}`} className="btn-ghost text-xs">
                Open the solicitation
              </Link>
            )}
          </div>
        </div>
      </WorkspacePane>
    );
  }

  if (detail.pane === "waiting") {
    const p = detail.pairing;
    return (
      <WorkspacePane
        header={<PaneHeader item={item} position={position} backHref={doneHref} />}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              No "complete" here, deliberately. Nothing an operator does
              finishes this item: the subcontractor does. A Done button on a
              task nobody here can finish teaches people to press it to make
              the row go away.
            */}
            <SkipAction
              nextHref={nextHref}
              doneHref={doneHref}
              label={nextHref ? "Leave it and go to the next" : "Leave it running"}
              className="btn-primary text-sm"
              shortcut="mod+Enter"
            />
            <SnoozeButton
              kind="opportunity"
              id={p.opportunityId}
              className="btn-ghost text-sm"
              label="Hide until later"
            />
            {p.threadKey && (
              <Link
                href={`/communications?c=${encodeURIComponent(p.threadKey)}`}
                className="btn-ghost text-sm"
              >
                Open the conversation
              </Link>
            )}
            {p.opportunityId && (
              <Link
                href={`/call-queue?opportunity=${p.opportunityId}`}
                className="btn-ghost text-sm"
              >
                Call them instead
              </Link>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-foreground">
            The quote request has gone and they have not answered. Nothing is wrong
            and nothing is stuck: this is here so the pipeline is visible, not
            because it needs you.
          </p>
          <Facts
            rows={[
              { label: "Firm", value: p.companyName ?? "Unnamed firm" },
              { label: "Trade", value: p.trade ?? "Not stated" },
              { label: "Sent", value: p.sentAt ? shortDate(p.sentAt) : "Not recorded" },
              {
                label: "Address",
                value: p.email
                  ? `${p.email}${p.emailVerified ? " (verified)" : " (unverified)"}`
                  : "None on file",
              },
              { label: "Phone", value: p.phone ?? "None on file" },
              { label: "Solicitation", value: p.opportunityTitle ?? "Untitled" },
            ]}
          />
          {!p.email && (
            <p className="rounded-md border border-risk/40 bg-risk/5 p-3 text-sm text-risk">
              There is no address on file for this firm, so the request cannot have
              reached them by mail. A call is the only route.
            </p>
          )}
        </div>
      </WorkspacePane>
    );
  }

  if (detail.pane === "quote") {
    const d = detail.opportunity;
    const trades = tradeState(d);
    const entered = recordedQuotes(d);
    const missing = trades.required.filter(
      (t) => !trades.quoted.some((q) => q.trim().toLowerCase() === t.trim().toLowerCase())
    );
    return (
      <WorkspacePane
        header={<PaneHeader item={item} position={position} backHref={doneHref} />}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <SkipAction
              nextHref={nextHref}
              doneHref={doneHref}
              label={nextHref ? "Done, next item" : "Done"}
              className="btn-primary text-sm"
              shortcut="mod+Enter"
            />
            <SnoozeButton
              kind="opportunity"
              id={String(d.opp.id)}
              className="btn-ghost text-sm"
            />
            <Link href={item.recordHref} className="btn-ghost text-sm">
              Open the full record
            </Link>
          </div>
        }
      >
        <div className="space-y-5">
          {/*
            What is still unpriced, before the form. The form asks for one
            trade at a time and this is the only thing that says how many times
            you are about to do that.
          */}
          <section>
            <h3 className="label mb-2">Still to price</h3>
            {trades.required.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The analysis did not name required trades on this one, so enter
                whatever you have and name the trade yourself.
              </p>
            ) : missing.length === 0 ? (
              <p className="text-sm text-pursue">
                Every required trade has a price. The bid build starts on its own.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {missing.map((t) => (
                  <li key={t} className="badge bg-review/15 text-review">
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {entered.length > 0 && (
            <section>
              <h3 className="label mb-2">Already recorded</h3>
              <ul className="divide-y divide-border/50 text-sm">
                {entered.map((q) => (
                  <li key={q.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate text-foreground">
                      {q.company}
                      {q.trade ? (
                        <span className="text-muted-foreground"> · {q.trade}</span>
                      ) : null}
                    </span>
                    <span className="num shrink-0 text-foreground">
                      {q.amount == null ? "No figure" : currency(q.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="label mb-2">Enter a price</h3>
            <QuoteEntryForm
              opportunityId={String(d.opp.id)}
              subs={quoteSubOptions(d)}
              layout="stacked"
              requiredTrades={trades.required}
              quotedTrades={trades.quoted}
            />
          </section>
        </div>
      </WorkspacePane>
    );
  }

  if (detail.pane === "bid") {
    const d = detail.opportunity;
    const bid = d.bid as Bid | null;
    const analysis = d.analysis as SolicitationAnalysis | null;
    return (
      <WorkspacePane
        header={<PaneHeader item={item} position={position} backHref={doneHref} />}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              The approve-and-send controls belong to the package itself, which
              knows about the lead-hours rule, the QA checklist and the override
              reason. Duplicating a Submit button down here would be a second
              path past those guards.
            */}
            <SkipAction
              nextHref={nextHref}
              doneHref={doneHref}
              label={nextHref ? "Leave it and go to the next" : "Back to the queue"}
            />
            <SnoozeButton
              kind="opportunity"
              id={String(d.opp.id)}
              className="btn-ghost text-sm"
            />
            <Link href={item.recordHref} className="btn-ghost text-sm">
              Open the full record
            </Link>
          </div>
        }
      >
        {bid ? (
          <div className="space-y-4">
            <Facts
              rows={[
                { label: "Solicitation", value: d.opp.title ?? "Untitled" },
                { label: "Agency", value: d.opp.agency ?? "Not stated" },
                {
                  label: "Deadline",
                  value: d.opp.deadline ? shortDate(String(d.opp.deadline)) : "Not stated",
                },
              ]}
            />
            <SubmissionPackage
              opportunityId={String(d.opp.id)}
              bid={bid}
              kindToPath={d.kindToPath}
              proofOptions={d.proofOptions}
              submissionMethod={analysis?.submission_method ?? null}
              contact={analysis?.contacts?.[0] ?? null}
              solicitationNumber={d.opp.solicitation_number ?? null}
              opportunityTitle={d.opp.title ?? null}
            />
            {!canSubmit && (
              <p className="text-xs text-muted-foreground">
                You can read the package but not approve or send it. An owner, admin
                or operator can.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No package has been assembled for this solicitation yet. The Bid Builder
            runs once every required trade has a price.
          </p>
        )}
      </WorkspacePane>
    );
  }

  // Blocker.
  const d = detail.opportunity;
  const flags = (d.opp.risk_flags ?? []).map((f) => flagLabel(String(f)));
  return (
    <WorkspacePane
      header={<PaneHeader item={item} position={position} backHref={doneHref} />}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {canDecide ? (
            <>
              {/*
                Re-running is the action that actually clears most of these:
                automation stopped, somebody fixed the cause, and the stage
                needs pushing again. It clears the human-action flag, which is
                what takes the row out of this queue.
              */}
              <AdvanceAction
                endpoint={`/api/opportunities/${d.opp.id}/action`}
                body={{ action: "rerun" }}
                nextHref={nextHref}
                doneHref={doneHref}
                className="btn-primary text-sm"
                busyLabel="Queueing…"
                shortcut="mod+Enter"
                toast={{ message: "Re-running this stage. The queue will move on its own." }}
              >
                {nextHref ? "Re-run & next" : "Re-run this stage"}
              </AdvanceAction>
              <AdvanceAction
                endpoint={`/api/opportunities/${d.opp.id}/action`}
                body={{ action: "send_back" }}
                nextHref={nextHref}
                doneHref={doneHref}
                className="btn-ghost text-sm"
                busyLabel="Sending back…"
                confirm={`Send "${d.opp.title ?? "this bid"}" back a stage?`}
                confirmLabel="Send it back"
                toast={{ message: "Sent back a stage." }}
              >
                Send back
              </AdvanceAction>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              You can read this but not act on it. An owner, admin, operator or
              estimator can.
            </p>
          )}
          <SkipAction nextHref={nextHref} doneHref={doneHref} label="Skip" />
          <SnoozeButton kind="opportunity" id={String(d.opp.id)} className="btn-ghost text-sm" />
          <Link href={item.recordHref} className="btn-ghost text-sm">
            Open the full record
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="rounded-md border border-risk/40 bg-risk/5 p-3">
          <h3 className="label mb-2 text-risk">What automation could not get past</h3>
          {flags.length === 0 ? (
            <p className="text-sm text-foreground">
              The record is flagged for a person but nothing named the reason. Open
              the record and read the automation log for this bid.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-foreground">
              {flags.map((f) => (
                <li key={f}>· {f}</li>
              ))}
            </ul>
          )}
        </section>

        <Facts
          rows={[
            { label: "Solicitation", value: d.opp.title ?? "Untitled" },
            { label: "Agency", value: d.opp.agency ?? "Not stated" },
            { label: "Stage", value: String(d.opp.stage ?? "").replace(/_/g, " ") || "Unknown" },
            {
              label: "Deadline",
              value: d.opp.deadline ? shortDate(String(d.opp.deadline)) : "Not stated",
            },
          ]}
        />

        <section>
          <h3 className="label mb-2">Contract value</h3>
          <EstimatedValue
            value={d.opp.value_estimated ?? null}
            source={d.opp.value_estimated_source ?? null}
          />
        </section>

        <p className="text-xs text-muted-foreground">
          {PANE_INTENT[pane]}
        </p>
      </div>
    </WorkspacePane>
  );
}

/** The pane's own header: what this is, and where you are in the queue. */
function PaneHeader({
  item,
  position,
  backHref,
}: {
  item: WorkItem;
  position: { index: number; total: number };
  /**
   * The way out, on a phone.
   *
   * The queue and the page header are both hidden once an item is open on a
   * narrow screen, so without this the only route back is the browser's own
   * Back button, and Esc is not a key a phone has.
   */
  backHref: string;
}) {
  const pane = paneFor(item);
  return (
    <div>
      <Link
        href={backHref}
        className="tap mb-2 inline-flex text-xs text-muted-foreground hover:text-accent lg:hidden"
      >
        Back to the queue
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{PANE_TITLE[pane]}</p>
          <h2 className="truncate text-base font-medium text-foreground">{item.title}</h2>
          {item.context && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.context}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {position.index >= 0 && (
            <span className="num text-xs text-muted-foreground">
              {position.index + 1} of {position.total}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A short labelled list. Missing values say so rather than rendering blank. */
function Facts({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{r.label}</dt>
          <dd className="text-sm text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
