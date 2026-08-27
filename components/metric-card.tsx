import { currency } from "@/lib/format";
import type { Metric } from "@/lib/domain/report-metrics";

/**
 * One reported figure, with the reason it can be trusted attached to it.
 *
 * Three rules, all of them the difference between a number and a misleading
 * number:
 *
 * A metric with nothing behind it prints the reason, not a nought. "No bids
 * decided yet" and "0%" look nothing alike to a person deciding whether their
 * process is working.
 *
 * A metric prints what it covers. A median over one decision is not a fact
 * about how the team decides, and the card says so rather than leaving
 * somebody to assume.
 *
 * A metric can always say how it was worked out. Folded away by default,
 * because most of the time nobody needs it, and there the moment somebody
 * disagrees with it.
 */
export function MetricCard({ metric }: { metric: Metric }) {
  const { value, unit, absent, coverage, provenance } = metric;

  const display =
    value == null
      ? null
      : unit === "percent"
        ? `${value}%`
        : unit === "days"
          ? `${value} ${value === 1 ? "day" : "days"}`
          : unit === "currency"
            ? currency(value)
            : String(value);

  return (
    <div className="card">
      <div className="label">{metric.label}</div>
      {display == null ? (
        /*
         * The sentence, at reading size rather than headline size. A reason
         * set in the same forty-point type as a real figure competes with the
         * cards that have one, and the eye reads the shape before the words.
         */
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{absent}</p>
      ) : (
        <div className="num mt-1.5 text-4xl font-semibold tracking-tight text-slate-900">
          {display}
        </div>
      )}

      {coverage && coverage.need > 0 && (
        /*
         * Phrased to avoid subject-verb agreement on a number that can be
         * anything: "0 of 1 record carry what this needs" is what the obvious
         * wording produces, and a figure presented in broken English is one
         * people trust less than it deserves.
         */
        <p className="mt-1.5 text-xs text-slate-500">
          {coverage.have < coverage.need
            ? `Based on ${coverage.have} of ${coverage.need} records`
            : `Based on all ${coverage.need} record${coverage.need === 1 ? "" : "s"}`}
        </p>
      )}

      <details className="mt-2">
        <summary className="tap cursor-pointer text-xs text-slate-500 hover:underline">
          How this is worked out
        </summary>
        <dl className="mt-1.5 space-y-1.5 text-xs leading-relaxed text-slate-600">
          <div>
            <dt className="font-semibold text-slate-700">Formula</dt>
            <dd>{provenance.formula}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Read from</dt>
            <dd>{provenance.sources.join(", ")}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">What is counted</dt>
            <dd>{provenance.inclusion}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

/** A titled group of metric cards, so the page reads as sections not a wall. */
export function MetricGroup({
  title,
  description,
  metrics,
}: {
  title: string;
  description?: string;
  metrics: Metric[];
}) {
  if (metrics.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
      )}
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard key={m.key} metric={m} />
        ))}
      </div>
    </section>
  );
}
