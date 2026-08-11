import { timeAgo, shortDate } from "@/lib/format";
import type { ActivityEvent } from "@/lib/domain/activity-timeline";

const KIND_BADGE: Record<ActivityEvent["kind"], string> = {
  system: "bg-slate-200 text-slate-700",
  email: "bg-accent/15 text-accent-strong",
  call: "bg-pursue/15 text-pursue",
  note: "bg-review/15 text-review",
  human: "bg-pursue/15 text-pursue-strong",
};

const KIND_LABEL: Record<ActivityEvent["kind"], string> = {
  system: "System",
  email: "Email",
  call: "Call",
  note: "Note",
  human: "You",
};

/**
 * Single chronological feed for opportunity activity (automation + outreach +
 * calls). Collapsed by default when long; always shows the newest items first.
 */
export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No activity yet. Scoring, outreach, and your calls will show up here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {events.map((e) => (
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
  );
}
