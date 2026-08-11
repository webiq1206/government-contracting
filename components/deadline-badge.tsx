import { deadlineStatus, DEFAULT_RULES, type AutomationRules } from "@/lib/domain/intake";
import { shortDate } from "@/lib/format";

const STYLE_LIGHT: Record<string, string> = {
  none: "bg-slate-200 text-slate-600",
  normal: "bg-pursue/10 text-pursue",
  approaching: "bg-review/15 text-review",
  urgent: "bg-risk/15 text-risk",
  past_due: "bg-risk text-white",
};

const STYLE_SHELL: Record<string, string> = {
  none: "bg-white/10 text-white/55",
  normal: "bg-pursue/20 text-pursue",
  approaching: "bg-review/25 text-review",
  urgent: "bg-risk/25 text-risk",
  past_due: "bg-risk text-white",
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
  variant = "light",
}: {
  deadline: string | null;
  rules?: Pick<AutomationRules, "approaching_days" | "urgent_days">;
  now?: Date;
  showDate?: boolean;
  variant?: "light" | "shell";
}) {
  const s = deadlineStatus(deadline, now ?? new Date(), rules);
  if (s.key === "none" && !showDate) return null;
  const styles = variant === "shell" ? STYLE_SHELL : STYLE_LIGHT;
  return (
    <span className={`badge whitespace-nowrap ${styles[s.key]}`} title={deadline ?? undefined}>
      {s.label}
      {showDate && deadline ? ` · ${shortDate(deadline)}` : ""}
    </span>
  );
}
