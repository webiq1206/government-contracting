"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ContextSection,
  WorkspacePane,
  WorkspacePlaceholder,
  WorkspaceShell,
} from "@/components/workspace/workspace-shell";
import { QueueRail, type QueueEntry, type QueueTone } from "@/components/workspace/queue-rail";
import { KeyHint } from "@/components/workspace/workspace-keys";
import { RequirementStateControl } from "@/components/requirement-state-control";
import { EmptyState } from "@/components/empty-state";
import {
  REQUIREMENT_STATE_LABEL,
  requirementProgress,
  type RequirementAudit,
  type RequirementState,
  type RequirementStateView,
} from "@/lib/domain/requirement-state";
import type { BriefRequirement } from "@/lib/domain/opportunity-brief";
import type { Owner } from "@/lib/domain/ownership";

/**
 * The checklist and the document it was read out of, on one screen.
 *
 * The panel that renders a document inside the record page says why this
 * exists, in its own words: "checking one extracted requirement against its
 * source used to mean opening a new tab, finding the page, reading a paragraph
 * and coming back. Doing that forty times is why nobody does it, and a
 * checklist nobody checks is a checklist that gets trusted more than it has
 * earned."
 *
 * That fix put the document behind a disclosure on the Files tab. The
 * checklist is on the Requirements tab. So the round trip survived: switch
 * tab, expand a file, read, switch back, find the row you were on. Forty
 * times, on the artifact that decides whether a bid is thrown out.
 *
 * Here the document does not move. Choosing a requirement opens the document
 * it was read from, and the requirement's own controls sit between the two.
 *
 * Client-side selection rather than a query parameter, unlike every other
 * workspace in the product. The reason is the iframe: navigating the page to
 * change the selected row would tear down and refetch the PDF on every
 * keystroke of J, which is the one thing this screen exists to avoid. The
 * pane's own state is cheap; the document is not.
 */

const TONE: Record<RequirementState, QueueTone> = {
  done: "done",
  not_applicable: "done",
  blocked: "blocked",
  needs_clarification: "attention",
  in_progress: "attention",
  not_started: "neutral",
};

export interface RequirementDoc {
  id: string;
  name: string;
  /** "pdf" | "image" | "none", already decided on the server. */
  preview: "pdf" | "image" | "none";
  pageCount: number | null;
}

/** Only the requirements a person has to do something about. */
type Filter = "open" | "blocking" | "clarify" | "all";

const FILTER_LABEL: Record<Filter, string> = {
  open: "Still open",
  blocking: "Can sink the bid",
  clarify: "Ask the agency",
  all: "Everything",
};

export function RequirementsWorkspace({
  opportunityId,
  requirements,
  states,
  history,
  documents,
  members,
  viewerId,
  canEdit,
  recordHref,
}: {
  opportunityId: string;
  requirements: BriefRequirement[];
  states: Record<string, RequirementStateView>;
  history: Record<string, RequirementAudit[]>;
  /** Everything stored against this bid that a browser can render. */
  documents: RequirementDoc[];
  members: Owner[];
  viewerId?: string;
  canEdit: boolean;
  recordHref: string;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(
    requirements[0]?.id ?? null
  );
  /**
   * Which document the right-hand pane is showing.
   *
   * Follows the selected requirement when that requirement names a source, and
   * otherwise stays where the reader put it. Moving it back to a default every
   * time they select a requirement with no anchor would take the document away
   * from somebody in the middle of reading it.
   */
  const [docId, setDocId] = useState<string | null>(documents[0]?.id ?? null);
  /**
   * Whether the reader has actually chosen a requirement, as opposed to the
   * pane having opened on the first one for a wide screen.
   *
   * The distinction only matters below `lg`, where there is one pane at a
   * time. Treating the default selection as "opened" hands a phone the
   * requirement on arrival and hides the checklist behind it, and this
   * workspace has no URL to go back to, so the only way out would be leaving
   * the record. Starts false; selecting sets it.
   */
  const [opened, setOpened] = useState(false);

  const stateOf = (id: string): RequirementState =>
    states[id]?.state ?? "not_started";

  const shown = useMemo(() => {
    if (filter === "all") return requirements;
    if (filter === "blocking") return requirements.filter((r) => r.disqualifying);
    if (filter === "clarify") {
      return requirements.filter((r) => stateOf(r.id) === "needs_clarification");
    }
    return requirements.filter((r) => {
      const s = stateOf(r.id);
      return s !== "done" && s !== "not_applicable";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, requirements, states]);

  const counts: Record<Filter, number> = {
    all: requirements.length,
    open: requirements.filter((r) => {
      const s = stateOf(r.id);
      return s !== "done" && s !== "not_applicable";
    }).length,
    blocking: requirements.filter((r) => r.disqualifying).length,
    clarify: requirements.filter((r) => stateOf(r.id) === "needs_clarification").length,
  };

  const selected =
    shown.find((r) => r.id === selectedId) ?? shown[0] ?? null;
  const index = selected ? shown.findIndex((r) => r.id === selected.id) : -1;

  function select(id: string) {
    setSelectedId(id);
    setOpened(true);
    const r = requirements.find((x) => x.id === id);
    /*
     * Follow the requirement to its source, when it has one. This is the whole
     * point of the screen: the anchor turns "stated in Section L.3" into the
     * page it was read from.
     */
    if (r?.sourceDocumentId && documents.some((d) => d.id === r.sourceDocumentId)) {
      setDocId(r.sourceDocumentId);
    }
  }

  function move(delta: number) {
    if (shown.length === 0) return;
    const next = index < 0 ? 0 : (index + delta + shown.length) % shown.length;
    select(shown[next].id);
  }

  const progress = requirementProgress(
    requirements.map((r) => ({ state: stateOf(r.id) }))
  );

  const entries: QueueEntry[] = shown.map((r) => {
    const s = stateOf(r.id);
    return {
      id: r.id,
      title: r.label,
      context: r.disqualifying
        ? "Can sink the bid"
        : r.sourceDocumentName ?? r.source ?? null,
      meta: r.sourcePage != null ? `p.${r.sourcePage}` : null,
      state: { label: REQUIREMENT_STATE_LABEL[s], tone: TONE[s] },
      done: s === "done" || s === "not_applicable",
    };
  });

  const doc = documents.find((d) => d.id === docId) ?? null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        /*
         * Scoped to this subtree rather than the window, because unlike the
         * other queues this one is not the whole page: the record's tabs and
         * header are above it, and a J pressed up there should not move a
         * checklist further down.
         */
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const el = e.target as HTMLElement;
        const tag = el?.tagName?.toLowerCase();
        if (el?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") {
          return;
        }
        if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      <WorkspaceShell
        selected={opened}
        queueLabel="Submission requirements"
        queueWidth="lg:w-[340px]"
        contextLabel="The solicitation"
        queue={
          <QueueRail
            entries={entries}
            selectedId={selected?.id ?? null}
            onSelect={select}
            heading="What it takes to bid"
            summary={
              progress.percent == null
                ? "Nothing was extracted from the solicitation yet."
                : `${progress.settled} of ${progress.total} settled.`
            }
            toolbar={
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      aria-pressed={f === filter}
                      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                        f === filter
                          ? "border-gold bg-gold/15 text-foreground"
                          : counts[f] === 0
                            ? "border-border text-muted-foreground"
                            : "border-border text-foreground hover:border-foreground/30"
                      }`}
                    >
                      {FILTER_LABEL[f]}
                      <span className="num text-muted-foreground">{counts[f]}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <KeyHint keys="J / K" label="move" />
                </div>
              </div>
            }
            empty={
              <EmptyState
                tone="success"
                title={
                  filter === "open"
                    ? "Every requirement is settled"
                    : "Nothing in this view"
                }
                description={
                  filter === "open"
                    ? "Each one is done or recorded as not applying. The counts above are over the whole checklist."
                    : "The counts above are over the whole checklist. Pick another view."
                }
              />
            }
          />
        }
        primary={
          selected ? (
            <WorkspacePane
              header={
                <div>
                  <button
                    type="button"
                    onClick={() => setOpened(false)}
                    className="tap mb-2 inline-flex text-xs text-muted-foreground hover:text-accent lg:hidden"
                  >
                    Back to the checklist
                  </button>
                  <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow mb-1">
                      {selected.disqualifying ? "Can sink the bid" : "Requirement"}
                    </p>
                    <h3 className="text-base font-medium text-foreground">
                      {selected.label}
                    </h3>
                    {selected.source && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Stated in {selected.source}
                      </p>
                    )}
                  </div>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {index + 1} of {shown.length}
                  </span>
                  </div>
                </div>
              }
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => move(1)}
                    className="btn-primary text-sm"
                    disabled={shown.length < 2}
                  >
                    Next requirement
                  </button>
                  {selected.sourceDocumentId &&
                    documents.some((d) => d.id === selected.sourceDocumentId) && (
                      <button
                        type="button"
                        onClick={() => setDocId(selected.sourceDocumentId!)}
                        className="btn-ghost text-sm"
                      >
                        Show where it says so
                      </button>
                    )}
                  <Link href={recordHref} className="btn-ghost text-sm">
                    Back to the record
                  </Link>
                </div>
              }
            >
              <div className="space-y-5">
                {selected.disqualifying && selected.disqualifyingReason && (
                  <p className="rounded-md border border-risk/40 bg-risk/5 p-3 text-sm text-risk">
                    {selected.disqualifyingReason}
                  </p>
                )}

                {selected.explain && (
                  <p className="text-sm text-muted-foreground">{selected.explain}</p>
                )}

                {selected.detail && (
                  <section>
                    <h4 className="label mb-1">What it asks for</h4>
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {selected.detail}
                    </p>
                  </section>
                )}

                <section>
                  <h4 className="label mb-2">Where it stands</h4>
                  <RequirementStateControl
                    opportunityId={opportunityId}
                    requirementId={selected.id}
                    label={selected.label}
                    view={states[selected.id] ?? untouchedView()}
                    members={members}
                    viewerId={viewerId}
                    history={history[selected.id] ?? []}
                    canEdit={canEdit}
                  />
                </section>

                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Who produces it
                    </dt>
                    <dd className="text-foreground">
                      {selected.owner === "platform"
                        ? "Brost Co produces this one"
                        : "You produce this one"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Read from
                    </dt>
                    {/*
                      * The name is resolved against the documents this pane
                      * already holds, not taken only from the analysis.
                      *
                      * The analysis records an id and a page and frequently no
                      * name, so reading only its name field said "did not
                      * resolve this to a document" about a requirement whose
                      * row two panes to the left was showing the page number.
                      */}
                    <dd
                      className={
                        sourceName(selected, documents)
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {sourceName(selected, documents)
                        ? `${sourceName(selected, documents)}${selected.sourcePage != null ? `, page ${selected.sourcePage}` : ""}`
                        : "The analysis did not resolve this to a document"}
                    </dd>
                  </div>
                  {selected.officialForm && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Official form
                      </dt>
                      <dd className="text-foreground">{selected.officialForm}</dd>
                    </div>
                  )}
                  {selected.needsSignature && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        Signature
                      </dt>
                      <dd className="text-foreground">
                        Has to be signed before it goes out
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </WorkspacePane>
          ) : (
            <WorkspacePlaceholder>
              Pick a requirement to record where it stands. The document it was read
              from opens beside it.
            </WorkspacePlaceholder>
          )
        }
        context={
          <div className="flex min-h-0 flex-col gap-3">
            {documents.length === 0 ? (
              <ContextSection title="The solicitation">
                <p className="text-sm text-muted-foreground">
                  Nothing readable is stored against this bid, so there is no source
                  to check the checklist against. The Files tab on the record says
                  what arrived and what could not be fetched.
                </p>
              </ContextSection>
            ) : (
              <>
                <div>
                  <label htmlFor="req-doc" className="label mb-1 block">
                    The document
                  </label>
                  <select
                    id="req-doc"
                    className="input w-full text-sm"
                    value={docId ?? ""}
                    onChange={(e) => setDocId(e.target.value)}
                  >
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.pageCount != null
                          ? ` (${d.pageCount} page${d.pageCount === 1 ? "" : "s"})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {doc == null || doc.preview === "none" ? (
                  <p className="text-sm text-muted-foreground">
                    A browser will not render this format, so it cannot be shown here.
                    Open it from the Files tab to read it.
                  </p>
                ) : (
                  <>
                    {doc.preview === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/documents/${doc.id}/open`}
                        alt={`${doc.name}, as it arrived`}
                        className="w-full rounded-md border border-border object-contain"
                      />
                    ) : (
                      <iframe
                        src={`/api/documents/${doc.id}/open`}
                        title={`${doc.name}, as it arrived`}
                        className="h-[60vh] w-full rounded-md border border-border xl:h-[calc(100vh-16rem)]"
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {/*
                        Said here for the same reason the Files tab says it: a
                        scan renders perfectly and was still read by nobody.
                      */}
                      This is the file as it arrived. Whether anything in it was read
                      is the state on the left.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        }
      />
    </div>
  );
}

/**
 * Which document a requirement was read out of, in words.
 *
 * The analysis carries a name only sometimes and an id nearly always, so this
 * prefers the name it recorded and otherwise looks the id up in the documents
 * on screen. Null when neither resolves, which is a real answer: a requirement
 * with no source is one nobody can check.
 */
function sourceName(
  requirement: BriefRequirement,
  documents: RequirementDoc[]
): string | null {
  if (requirement.sourceDocumentName) return requirement.sourceDocumentName;
  if (!requirement.sourceDocumentId) return null;
  return documents.find((d) => d.id === requirement.sourceDocumentId)?.name ?? null;
}

/**
 * The view for a requirement nothing has ever been recorded against.
 *
 * Defensive only: the server builds a view for every requirement, including
 * the untouched ones. It exists so a checklist that arrives one item longer
 * than its tracking renders that item rather than throwing.
 *
 * `untouched: true` rather than `not_started`, which is somebody saying they
 * have not begun. A control that renders the two identically claims a decision
 * nobody made. `upload` for the same reason parseVerification falls back to
 * it: the safe direction is asking for something that turns out to be
 * unnecessary, not quietly deciding there is nothing to prove.
 */
function untouchedView(): RequirementStateView {
  return {
    state: "not_started",
    verification: "upload",
    humanVerified: false,
    owner: null,
    dueAt: null,
    blockingReason: null,
    note: null,
    updatedAt: null,
    updatedBy: null,
    untouched: true,
  };
}
