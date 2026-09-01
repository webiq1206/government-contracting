import type { BriefRequirement, OpportunityBrief } from "@/lib/domain/opportunity-brief";
import { InfoTip } from "@/components/info-tip";
import { RequirementStateControl } from "@/components/requirement-state-control";
import {
  requirementProgress,
  type RequirementAudit,
  type RequirementState,
  type RequirementStateView,
} from "@/lib/domain/requirement-state";
import type { Owner } from "@/lib/domain/ownership";

/**
 * Everything the checklist needs beyond the solicitation itself.
 *
 * Optional as a block: the theme QA page and any caller without a database
 * behind it renders the list exactly as it did before, and nothing about the
 * requirements themselves depends on the tracking being wired up.
 */
export interface RequirementTracking {
  opportunityId: string;
  /** Recorded state per requirement id. Missing means nobody has touched it. */
  states: Record<string, RequirementStateView>;
  history: Record<string, RequirementAudit[]>;
  members: Owner[];
  viewerId?: string;
  canEdit: boolean;
}

/**
 * What it takes to bid, in the order that matters.
 *
 * The things that get a bid thrown out come first, under a heading that says
 * so. Then required, recommended, optional, and background, each labelled
 * rather than left for the reader to infer from the wording. Every item says
 * whether the platform handles it or the operator has to, because "Signed
 * SF-1449" and "Pricing schedule" look equally alarming until you know one of
 * them is produced for you.
 *
 * Above all of that, when there is anything in it, sits Needs clarification.
 * That group is not a filter over the list below and it is not sorted by
 * importance: it is the set of items whose next action is a question to
 * somebody outside this company, and a question asked eleven days out gets
 * answered while the same question asked eleven hours out does not. Leaving
 * those interleaved with items this office can simply do is how they get
 * noticed on the last afternoon.
 */
export function BidRequirements({
  brief,
  tracking,
}: {
  brief: OpportunityBrief;
  tracking?: RequirementTracking;
}) {
  if (brief.empty) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <p className="label">What it takes to bid</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          No submission requirements were extracted yet. Until the analysis finishes, treat
          the original solicitation as the source of truth. Retry analysis from the Files
          tab if the solicitation is already attached.
        </p>
      </div>
    );
  }

  const { counts } = brief;
  const summary = [
    counts.required ? `${counts.required} required` : "",
    counts.recommended ? `${counts.recommended} recommended` : "",
    counts.optional ? `${counts.optional} optional` : "",
    counts.info ? `${counts.info} to be aware of` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const stateOf = (r: BriefRequirement): RequirementState =>
    tracking?.states[r.id]?.state ?? "not_started";

  /*
   * Background conditions are nobody's task, so they are not obligations and
   * do not belong in a progress figure. Counting them would let a bid read as
   * two thirds handled on the strength of items nobody has to do.
   */
  const trackable = brief.requirements.filter((r) => r.importance !== "info");
  const progress = requirementProgress(trackable.map((r) => ({ state: stateOf(r) })));

  const clarify = brief.requirements.filter((r) => stateOf(r) === "needs_clarification");
  const inClarify = new Set(clarify.map((r) => r.id));
  const rest = brief.requirements.filter((r) => !inClarify.has(r.id));

  const disqualifiers = brief.disqualifiers.filter((r) => !inClarify.has(r.id));
  const required = rest.filter((r) => r.importance === "required" && !r.disqualifying);
  const recommended = rest.filter((r) => r.importance === "recommended");
  const optional = rest.filter((r) => r.importance === "optional");
  const info = rest.filter((r) => r.importance === "info");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
          What it takes to bid
        </h3>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </div>

      {tracking && (
        <p className="mb-4 text-xs text-muted-foreground">
          {/*
            Never a percentage over an empty list, and never a percentage that
            counts an in-progress item as half done. Settled means done or
            decided not to apply; everything else is outstanding.
          */}
          {progress.percent == null
            ? "Nothing here is being tracked yet."
            : `${progress.settled} of ${progress.total} settled. The rest are outstanding.`}
        </p>
      )}

      {clarify.length > 0 && (
        <div className="mb-5 rounded-md border border-review/40 bg-review/5 px-4 py-3">
          <p className="text-sm font-semibold text-review">
            Needs clarification before anybody can do it
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The solicitation is unclear or two parts of it disagree. Each of these needs a
            question put to the contracting officer, and the answer takes days rather than
            minutes.
          </p>
          <ul className="mt-3 space-y-3">
            {clarify.map((r) => (
              <Item key={r.id} req={r} tracking={tracking} showWhy={r.disqualifying} />
            ))}
          </ul>
        </div>
      )}

      {disqualifiers.length > 0 && (
        <div className="mb-5 rounded-md border border-risk/40 bg-risk/5 px-4 py-3">
          <p className="text-sm font-semibold text-risk">
            Miss any of these and the bid is rejected
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Not scored lower. Not evaluated at all.
          </p>
          <ul className="mt-3 space-y-3">
            {disqualifiers.map((r) => (
              <Item key={r.id} req={r} tracking={tracking} showWhy />
            ))}
          </ul>
        </div>
      )}

      <Group
        title="Also required"
        blurb="Part of a complete bid. Marked so you can see what is handled for you."
        items={required}
        tracking={tracking}
      />
      <Group
        title="Recommended"
        blurb="Not mandatory, but the solicitation asks for these and they affect scoring."
        items={recommended}
        tracking={tracking}
      />
      <Group
        title="Optional"
        blurb="Skipping these costs you nothing. Do them only if they help your case."
        items={optional}
        tracking={tracking}
      />
      <Group
        title="Worth knowing"
        blurb="Conditions that change how the job is priced or performed."
        items={info}
        tracking={tracking}
      />
    </div>
  );
}

function Group({
  title,
  blurb,
  items,
  tracking,
}: {
  title: string;
  blurb: string;
  items: BriefRequirement[];
  tracking?: RequirementTracking;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="label">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      <ul className="mt-2.5 space-y-3">
        {items.map((r) => (
          <Item key={r.id} req={r} tracking={tracking} />
        ))}
      </ul>
    </div>
  );
}

function Item({
  req,
  showWhy,
  tracking,
}: {
  req: BriefRequirement;
  showWhy?: boolean;
  tracking?: RequirementTracking;
}) {
  const view = tracking?.states[req.id];
  return (
    <li className="border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-foreground">{req.label}</span>
        {/* Background conditions are nobody's task, so an owner tag on them is
            noise in a list where the tag is supposed to mean "your job". */}
        {req.importance !== "info" && <OwnerTag owner={req.owner} />}
        {req.needsSignature && (
          <span className="badge bg-surface-raised text-slate-600">Needs your signature</span>
        )}
        {req.explain && (
          <InfoTip label={`What ${req.label} means`}>{req.explain}</InfoTip>
        )}
      </div>
      {showWhy && req.disqualifyingReason && (
        <p className="mt-1 text-sm text-slate-700">{req.disqualifyingReason}</p>
      )}
      {req.detail && <p className="mt-1 text-sm text-muted-foreground">{req.detail}</p>}
      <SourceLine req={req} />
      {/* Background conditions carry no state: there is nothing to be done, so
          there is nothing to be part-way through. */}
      {tracking && view && req.importance !== "info" && (
        <RequirementStateControl
          opportunityId={tracking.opportunityId}
          requirementId={req.id}
          label={req.label}
          view={view}
          members={tracking.members}
          viewerId={tracking.viewerId}
          history={tracking.history[req.id] ?? []}
          canEdit={tracking.canEdit}
        />
      )}
    </li>
  );
}

/**
 * Where this requirement came from, and a way to go and read it.
 *
 * "Stated in Section L.3" is useful and unopenable: it tells an operator the
 * requirement exists without giving them any way to check it, which for a
 * two-hundred-page specification means taking the extraction on trust. When
 * the analysis resolved a real document, the line becomes a link onto the page
 * it was read from.
 *
 * When it did not resolve one, the line says only what is true. A requirement
 * with no anchor is not hidden and not decorated with a dead link: it is shown
 * with its stated location and nothing more, so the difference between
 * "checkable" and "take our word for it" is visible rather than implied.
 */
function SourceLine({ req }: { req: BriefRequirement }) {
  const stated = req.source ? `Stated in ${req.source}` : null;
  if (!req.sourceDocumentId) {
    return stated ? <p className="mt-1 text-xs text-muted-foreground">{stated}</p> : null;
  }
  const where = req.sourcePage ? `?page=${req.sourcePage}` : "";
  const label = req.sourcePage
    ? `${req.sourceDocumentName ?? "source document"}, page ${req.sourcePage}`
    : (req.sourceDocumentName ?? "source document");
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {stated ? `${stated} · ` : ""}
      <a
        className="underline underline-offset-2 hover:text-foreground"
        href={`/api/documents/${req.sourceDocumentId}/open${where}`}
        target="_blank"
        rel="noreferrer"
      >
        Read it in {label}
      </a>
    </p>
  );
}

/**
 * "Automatic" is the load-bearing word here: it tells the operator which of a
 * long list they can stop worrying about.
 */
function OwnerTag({ owner }: { owner: BriefRequirement["owner"] }) {
  return owner === "platform" ? (
    <span className="badge bg-pursue-soft text-pursue-strong">Automatic</span>
  ) : (
    <span className="badge bg-surface-raised text-slate-600">You</span>
  );
}
