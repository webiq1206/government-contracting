import { deadlineStatus, DEFAULT_RULES, type AutomationRules } from "@/lib/domain/intake";
import { shortDate } from "@/lib/format";

const STYLE: Record<string, string> = {
  none: "bg-slate-200 text-slate-600",
  normal: "bg-pursue/10 text-pursue",
  approaching: "bg-review/15 text-review",
  urgent: "bg-risk/15 text-risk",
  past_due: "bg-risk text-white",
};

/**
 * Deadline urgency badge: color + written status + day count together, so the
 * meaning never relies on color alone. Thresholds come from Settings →
 * Automation rules; every list and detail view renders this same component so
 * "urgent" means the same thing everywhere.
 */
export function DeadlineBadge({
  deadline,
  rules = DEFAULT_RULES,
  now,
  showDate = false,
}: {
  deadline: string | null;
  rules?: Pick<AutomationRules, "approaching_days" | "urgent_days">;
  /** Injectable for tests; defaults to the render moment. */
  now?: Date;
  showDate?: boolean;
}) {
  const s = deadlineStatus(deadline, now ?? new Date(), rules);
  if (s.key === "none" && !showDate) return null;
  return (
    <span className={`badge whitespace-nowrap ${STYLE[s.key]}`} title={deadline ?? undefined}>
      {s.label}
      {showDate && deadline ? ` · ${shortDate(deadline)}` : ""}
    </span>
  );
}
