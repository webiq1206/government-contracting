import Link from "next/link";
import type { CalendarMonth } from "@/lib/domain/compliance-calendar";

const TONE: Record<string, string> = {
  red: "bg-risk",
  amber: "bg-review",
  green: "bg-pursue",
  slate: "bg-border",
};

/**
 * A month of renewal dates.
 *
 * The board's ninety-day strip answers "which of these lands first". It does
 * not answer "what does March look like", which is the question somebody asks
 * when they are deciding which week to be away, or noticing that three
 * renewals have stacked on the same Friday.
 *
 * The grid is the overview and the list beneath it is the detail, because a
 * square four characters wide cannot carry a label anybody can read, and a
 * calendar whose entries are unreadable is decoration.
 */
export function ComplianceCalendar({
  cal,
  hrefFor,
}: {
  cal: CalendarMonth;
  /** Builds the link for a month, preserving whatever filters are on. */
  hrefFor: (month: string) => string;
}) {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{cal.label}</h2>
        <div className="flex items-center gap-2">
          <Link href={hrefFor(cal.prevMonth)} className="tap text-xs text-accent hover:underline">
            Previous
          </Link>
          <Link href={hrefFor(cal.nextMonth)} className="tap text-xs text-accent hover:underline">
            Next
          </Link>
        </div>
      </div>

      {/*
        Hidden below sm rather than squeezed. Seven columns on a 390px screen
        gives each day about fifty pixels, which is not enough for a date and a
        marker, and the list below carries the same information in a shape a
        phone can actually read.
      */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
          {dayNames.map((d) => (
            <div key={d} className="bg-surface-raised px-2 py-1 text-center text-xs text-muted-foreground">
              {d}
            </div>
          ))}
          {cal.weeks.flat().map((day) => (
            <div
              key={day.date}
              className={`min-h-16 bg-surface p-1.5 ${day.inMonth ? "" : "opacity-40"}`}
            >
              <p
                className={`text-xs ${
                  day.isToday
                    ? "font-semibold text-accent-strong"
                    : "text-muted-foreground"
                }`}
              >
                {day.dayOfMonth}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {day.items.map((i) => (
                  <span
                    key={i.id}
                    // The label is in the list below; here it is a marker with
                    // a title, because four characters of text is worse than
                    // none.
                    title={`${i.label} (${i.state})`}
                    className={`h-2 w-2 rounded-full ${TONE[i.tone] ?? "bg-border"}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="label mb-2">Landing this month</h3>
        {cal.listed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing falls due in {cal.label}.</p>
        ) : (
          <ul className="divide-y divide-border">
            {cal.listed.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-2 py-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[i.tone] ?? "bg-border"}`} />
                <span className="num text-xs text-muted-foreground">{i.dueAt.slice(0, 10)}</span>
                <span className="text-sm text-foreground">{i.label}</span>
                <span className="text-xs text-muted-foreground">{i.state}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cal.undated.length > 0 && (
        <div>
          <h3 className="label mb-2">No date, so no square</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            {/*
              Shown rather than dropped. An item with no date is not a thing
              that has been handled; it is one nobody can count down, and a
              calendar that silently omits it hides the gap.
            */}
            These cannot be placed on a calendar until somebody records when they fall due.
          </p>
          <ul className="divide-y divide-border">
            {cal.undated.map((i) => (
              <li key={i.id} className="py-2 text-sm text-foreground">
                {i.label}
                <span className="ml-2 text-xs text-muted-foreground">{i.state}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
