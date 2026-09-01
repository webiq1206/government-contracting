import Link from "next/link";
import {
  SYSTEM_STATUS_LABEL,
  type SystemStatusItem,
  type SystemStatusKind,
} from "@/lib/domain/system-status";

const KIND_TONE: Record<SystemStatusKind, string> = {
  working: "bg-pursue/15 text-pursue",
  needs_attention: "bg-review/15 text-review",
  waiting: "bg-muted text-muted-foreground",
  delayed: "bg-review/15 text-review",
  failed: "bg-risk/15 text-risk",
  disconnected: "bg-risk/15 text-risk",
  action_required: "bg-review/15 text-review",
};

/**
 * Whether the platform is working, in words a new user can act on.
 *
 * Shown on Today so a person does not have to visit Settings, Agents, and
 * Integrations to find out that email is down.
 */
export function SystemStatusPanel({ items }: { items: SystemStatusItem[] }) {
  if (items.length === 0) return null;
  const problems = items.filter((i) => i.kind !== "working");
  return (
    <section
      id="system-status"
      aria-labelledby="system-status-heading"
      className="panel scroll-mt-12 px-4 py-3 sm:px-5 sm:py-4"
    >
      <p className="eyebrow-gold">System and connections</p>
      <h2 id="system-status-heading" className="mt-1 font-display text-2xl font-normal text-foreground">
        {problems.length === 0
          ? "Everything that should be running is running"
          : `${problems.length} connection${problems.length === 1 ? "" : "s"} need${problems.length === 1 ? "s" : ""} a look`}
      </h2>
      <ul className="mt-3 divide-y divide-border/55 dark:divide-white/10">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <span className={`badge ${KIND_TONE[item.kind]}`}>
                  {SYSTEM_STATUS_LABEL[item.kind]}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
            {item.href && item.kind !== "working" && (
              <Link
                href={item.href}
                className="btn-primary shrink-0 text-xs"
              >
                {item.actionLabel ?? "Open"}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
