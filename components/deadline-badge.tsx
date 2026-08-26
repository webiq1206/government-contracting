import { deadlineStatus, DEFAULT_RULES, type AutomationRules } from "@/lib/domain/intake";
import { shortDate } from "@/lib/format";

const STYLE: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  normal: "bg-pursue/10 text-pursue",
  approaching: "bg-review/15 text-review",
  urgent: "bg-risk/15 text-risk",
  past_due: "bg-risk text-on-status",
};

/**
 * Deadline urgency badge: color + written status + day count together, so the
 * meaning never relies on color alone.
 */
export function DeadlineBadge({
  deadline,
  rules = DEFAULT_RULES,
  now,
  showDate = false,
  variant: _variant = "light",
}: {
  deadline: string | null;
  rules?: Pick<AutomationRules, "approaching_days" | "urgent_days">;
  now?: Date;
  showDate?: boolean;
  /** @deprecated Theme tokens cover both surfaces; kept for call-site compatibility. */
  variant?: "light" | "shell";
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
