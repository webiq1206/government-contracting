"use client";

import { useState } from "react";
import { timeAgo, shortDate } from "@/lib/format";
import {
  activityCounts,
  filterActivity,
  type ActivityEvent,
  type ActivityKind,
} from "@/lib/domain/activity-timeline";

const KIND_BADGE: Record<ActivityKind, string> = {
  system: "bg-slate-200 text-slate-700",
  email: "bg-accent/15 text-accent-strong",
  call: "bg-pursue/15 text-pursue",
  note: "bg-review/15 text-review",
  human: "bg-pursue/15 text-pursue-strong",
  quote: "bg-gold/20 text-gold-text",
  document: "bg-muted text-muted-foreground",
};

const KIND_LABEL: Record<ActivityKind, string> = {
  system: "System",
  email: "Email",
  call: "Call",
  note: "Note",
  human: "You",
  quote: "Quote",
  document: "Document",
};

/** Fixed order, so the row does not reshuffle as a bid progresses. */
const ORDER: ActivityKind[] = ["human", "system", "email", "call", "quote", "document", "note"];

/**
 * Single chronological feed for opportunity activity (automation, outreach,
 * calls, quotes, documents and every decision a person made), newest first.
 *
 * Filtering is a lens and never an edit. Nothing is removed, the counts on the
 * chips are counts of the whole feed rather than of what is showing, and when
 * a filter is on the footer says how many events it is hiding. A record of
 * what happened that quietly shows eleven of ninety is a record somebody reads
 * as ninety, and this feed is the one an operator reaches for when a bid has
 * gone wrong and they need to know what the platform actually did.
 *
 * The filter lives in the component rather than in the URL because the feed is
 * one section of a seven-section page: putting it in the URL would make
 * "show me only the emails" a navigation that resets the scroll position and
 * the tab, which is a worse answer to a smaller question.
 */
export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  const [selected, setSelected] = useState<ActivityKind[]>([]);

  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No activity yet. Scoring, outreach, and your calls will show up here.
      </p>
    );
  }

  const counts = activityCounts(events);
  const present = ORDER.filter((k) => counts[k] > 0);
  const shown = filterActivity(events, selected);
  const hidden = events.length - shown.length;

  const toggle = (k: ActivityKind) =>
    setSelected((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <div>
      {/* One kind is nothing to filter: a row of one chip is a control that
          cannot change anything. */}
      {present.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="sr-only" id="activity-filter-label">
            Show only these kinds of activity
          </span>
          <div
            role="group"
            aria-labelledby="activity-filter-label"
            className="flex flex-wrap items-center gap-1.5"
          >
            {present.map((k) => {
              const on = selected.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(k)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors lg:min-h-0 lg:py-1.5 ${
                    on
                      ? "border-gold bg-gold/15 text-foreground"
                      : "border-border text-foreground hover:border-foreground/30"
                  }`}
                >
                  {KIND_LABEL[k]}
                  {/* The count of the whole feed, not of what is showing.
                      A chip whose number changed as you filtered would be
                      reporting the filter rather than the record. */}
                  <span className="num text-muted-foreground">{counts[k]}</span>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              className="tap text-xs text-accent hover:underline"
              onClick={() => setSelected([])}
            >
              Show everything
            </button>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {shown.map((e) => (
          <li key={e.id} className="border-l-2 border-border pl-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`badge ${KIND_BADGE[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
              {e.actor && e.actor !== KIND_LABEL[e.kind] && (
                <span className="text-slate-500">{e.actor}</span>
              )}
              <span className="ml-auto text-slate-500" title={shortDate(e.at)}>
                {timeAgo(e.at)}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-slate-900">{e.title}</p>
            {e.detail && (
              <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500">
                {e.detail}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/*
        What the filter is holding back, stated rather than implied. Deleting
        nothing is the rule; saying so is what makes the rule visible.
      */}
      {hidden > 0 && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {hidden} more {hidden === 1 ? "event is" : "events are"} in this record and hidden by
          the filter. Nothing has been removed.
        </p>
      )}
    </div>
  );
}
