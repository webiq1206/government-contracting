import Link from "next/link";
import type { PulseFinding } from "@/lib/domain/pipeline-pulse";

/**
 * The pipeline pulse, rendered where it cannot be missed. Each finding names
 * a broken leg of the machine (discovery, movement, outreach), says what the
 * customer is losing while it stays broken, and links the fix.
 */
export function PipelinePulse({ findings, compact = false }: { findings: PulseFinding[]; compact?: boolean }) {
  if (findings.length === 0) return null;
  if (compact) {
    return (
      <section aria-label="Automation needs attention" className="divide-y divide-border rounded-md border border-review/40 bg-surface px-4">
        {findings.map((finding) => (
          <div key={finding.key} className="py-2">
            <details>
              <summary className={`min-h-11 cursor-pointer py-2 text-sm font-semibold ${finding.severity === "down" ? "text-risk" : "text-foreground"}`}>
                {finding.title}
              </summary>
              <p className="pb-2 text-sm text-muted-foreground">{finding.detail}</p>
            </details>
            <Link href={finding.href} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-2">
              {finding.cta}
            </Link>
          </div>
        ))}
      </section>
    );
  }
  return (
    <div className="space-y-3">
      {findings.map((f) => (
        <div
          key={f.key}
          className={
            f.severity === "down"
              ? "rounded-md border border-risk/40 bg-risk/10 px-4 py-3 text-sm"
              : "rounded-md border border-review/40 bg-review/10 px-4 py-3 text-sm"
          }
        >
          <p className={f.severity === "down" ? "font-semibold text-risk" : "font-semibold"}>
            {f.title}
          </p>
          <p className="mt-1 text-muted-foreground">{f.detail}</p>
          <p className="mt-2">
            {/*
              A link, and a 44px thing to hit.
              An inline anchor is as tall as its line box, which is 16px, and
              this is the control that fixes a broken pipeline: the one link on
              the page somebody in a truck most needs to hit first time.
            */}
            <Link
              href={f.href}
              className="inline-flex min-h-11 items-center font-medium underline lg:min-h-0"
            >
              {f.cta}
            </Link>
          </p>
        </div>
      ))}
    </div>
  );
}
