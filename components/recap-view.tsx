import Link from "next/link";
import type { Recap, RecapItem, RecapSection } from "@/lib/domain/recap/types";
import { ageNote } from "@/lib/domain/recap/sections";

/**
 * The recap, on the page.
 *
 * The same `Recap` object the email renders, drawn for a browser instead. Both
 * surfaces are pure renderers over one assembled result, which is the only way
 * the page and the mail can be relied on to agree: two builders would drift,
 * and somebody would act on a page that contradicts the mail they were sent.
 *
 * Tone is never carried by colour alone here either. Every urgent row states
 * its reason in words, and the ordering puts the oldest first, so the list is
 * readable in monochrome and to a screen reader.
 */

function toneClasses(section: RecapSection, item: RecapItem): string {
  const critical = item.severity === "critical";
  const warning = item.severity === "warning";
  if (section.emphasis === "urgent" || section.emphasis === "problem") {
    return critical
      ? "border-risk/50 bg-risk/5"
      : "border-review/50 bg-review/5";
  }
  if (critical) return "border-risk/40 bg-risk/5";
  if (warning) return "border-review/40 bg-review/5";
  return "border-border bg-surface";
}

function ItemRow({ section, item }: { section: RecapSection; item: RecapItem }) {
  const age = ageNote(item.ageDays);
  const tag =
    item.reason ??
    (section.emphasis === "urgent"
      ? item.severity === "critical"
        ? "Urgent"
        : "Needs attention"
      : section.emphasis === "problem"
        ? item.severity === "critical"
          ? "Broken"
          : "Degraded"
        : null);

  return (
    <li className={`rounded-md border p-3 ${toneClasses(section, item)}`}>
      {tag && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {tag}
        </p>
      )}
      <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">
        {item.href ? (
          <Link href={item.href} className="underline decoration-gold/60 underline-offset-2 hover:text-gold-text">
            {item.title}
          </Link>
        ) : (
          item.title
        )}
      </p>
      {item.detail && <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>}
      {item.when && <p className="mt-0.5 text-xs text-foreground/80">{item.when}</p>}
      {age && <p className="mt-1 text-xs italic text-muted-foreground">{age}</p>}
    </li>
  );
}

function Totals({ section }: { section: RecapSection }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {section.totals.map((t) => (
        <div key={t.label} className="panel-inset rounded-md p-3">
          <p className="num text-xl font-semibold text-foreground">{t.value}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {t.href ? (
              <Link href={t.href} className="underline decoration-gold/50 underline-offset-2 hover:text-gold-text">
                {t.label}
              </Link>
            ) : (
              t.label
            )}
          </p>
          {t.note && <p className="mt-0.5 text-[11px] text-review">{t.note}</p>}
        </div>
      ))}
    </div>
  );
}

function Section({ section }: { section: RecapSection }) {
  const urgent = section.emphasis === "urgent" && section.items.length > 0;
  const problem = section.emphasis === "problem" && section.items.length > 0;

  return (
    <section
      className={`card p-4 ${
        urgent ? "border-risk/40" : problem ? "border-review/40" : ""
      }`}
      aria-labelledby={`recap-${section.key}`}
    >
      <header className="mb-3 border-b border-border pb-2">
        <h2
          id={`recap-${section.key}`}
          className="font-display text-base font-semibold text-foreground"
        >
          {section.title}
          {section.items.length > 0 && (
            <span className="num ml-2 text-sm font-normal text-muted-foreground">
              {section.items.length}
            </span>
          )}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{section.blurb}</p>
      </header>

      {section.totals.length > 0 && <Totals section={section} />}

      {section.items.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {section.items.map((item) => (
            <ItemRow key={item.key} section={section} item={item} />
          ))}
        </ul>
      ) : (
        section.totals.length === 0 && (
          <p className="text-sm text-muted-foreground">{section.empty}</p>
        )
      )}
    </section>
  );
}

export function RecapView({ recap }: { recap: Recap }) {
  if (recap.quiet) {
    return (
      <div className="card mx-auto max-w-2xl p-6 text-center">
        <p className="eyebrow-gold">{recap.dayLabel}</p>
        <h2 className="font-display mt-1 text-lg font-semibold text-foreground">A quiet day</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Nothing needed a person and nothing broke. No urgent items, no system problems, and no
          activity worth reporting. This is the short version on purpose.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {recap.partial && (
        <p className="panel-inset rounded-md px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          This day is still running, so these are the totals so far rather than the final ones.
        </p>
      )}
      {recap.urgentCount > 0 && (
        <p className="rounded-md border border-risk/50 bg-risk/5 px-3 py-2 text-sm text-foreground">
          <strong className="text-risk">
            {recap.urgentCount} {recap.urgentCount === 1 ? "item needs" : "items need"} attention.
          </strong>{" "}
          They are listed first, oldest at the top of each group.
        </p>
      )}
      {recap.sections.map((section) => (
        <Section key={section.key} section={section} />
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every figure here comes from records in the app, counted for {recap.dayLabel} in{" "}
        {recap.timezone}. Nothing is estimated.
      </p>
    </div>
  );
}
