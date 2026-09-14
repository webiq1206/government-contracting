/**
 * The one status pill.
 *
 * Every status pairs a colour with a word, and the word is the part that
 * survives colour blindness and a monochrome print. Tones are the design
 * system's four meanings plus a neutral, so a new status cannot invent a
 * fifth colour.
 */
export type PillTone = "good" | "attention" | "blocked" | "neutral" | "accent";

const TONE: Record<PillTone, string> = {
  good: "bg-pursue-soft text-pursue-strong",
  attention: "bg-review/15 text-review",
  blocked: "bg-risk/15 text-risk",
  neutral: "bg-surface-raised text-muted-foreground",
  accent: "bg-accent-soft text-accent-strong",
};

export function StatusPill({ tone = "neutral", children, className = "" }: { tone?: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={`badge ${TONE[tone]} ${className}`.trim()}>{children}</span>;
}
