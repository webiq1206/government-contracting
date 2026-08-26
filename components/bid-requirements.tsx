import type { BriefRequirement, OpportunityBrief } from "@/lib/domain/opportunity-brief";
import { InfoTip } from "@/components/info-tip";

/**
 * What it takes to bid, in the order that matters.
 *
 * The things that get a bid thrown out come first, under a heading that says
 * so. Then required, recommended, optional, and background, each labelled
 * rather than left for the reader to infer from the wording. Every item says
 * whether the platform handles it or the operator has to, because "Signed
 * SF-1449" and "Pricing schedule" look equally alarming until you know one of
 * them is produced for you.
 */
export function BidRequirements({ brief }: { brief: OpportunityBrief }) {
  if (brief.empty) {
    return (
      <div className="rounded-md border border-border bg-surface px-4 py-3">
        <p className="label">What it takes to bid</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          No submission requirements were extracted yet. Until the analysis finishes, treat
          the original solicitation as the source of truth for what has to be submitted.
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

  const required = brief.requirements.filter(
    (r) => r.importance === "required" && !r.disqualifying
  );
  const recommended = brief.requirements.filter((r) => r.importance === "recommended");
  const optional = brief.requirements.filter((r) => r.importance === "optional");
  const info = brief.requirements.filter((r) => r.importance === "info");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
          What it takes to bid
        </h3>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </div>

      {brief.disqualifiers.length > 0 && (
        <div className="mb-5 rounded-md border border-risk/40 bg-risk/5 px-4 py-3">
          <p className="text-sm font-semibold text-risk">
            Miss any of these and the bid is rejected
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Not scored lower. Not evaluated at all.
          </p>
          <ul className="mt-3 space-y-3">
            {brief.disqualifiers.map((r) => (
              <Item key={r.id} req={r} showWhy />
            ))}
          </ul>
        </div>
      )}

      <Group
        title="Also required"
        blurb="Part of a complete bid. Marked so you can see what is handled for you."
        items={required}
      />
      <Group
        title="Recommended"
        blurb="Not mandatory, but the solicitation asks for these and they affect scoring."
        items={recommended}
      />
      <Group
        title="Optional"
        blurb="Skipping these costs you nothing. Do them only if they help your case."
        items={optional}
      />
      <Group
        title="Worth knowing"
        blurb="Conditions that change how the job is priced or performed."
        items={info}
      />
    </div>
  );
}

function Group({
  title,
  blurb,
  items,
}: {
  title: string;
  blurb: string;
  items: BriefRequirement[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="label">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      <ul className="mt-2.5 space-y-3">
        {items.map((r) => (
          <Item key={r.id} req={r} />
        ))}
      </ul>
    </div>
  );
}

function Item({ req, showWhy }: { req: BriefRequirement; showWhy?: boolean }) {
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
