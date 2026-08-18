import Link from "next/link";
import type { PulseFinding } from "@/lib/domain/pipeline-pulse";

/**
 * The pipeline pulse, rendered where it cannot be missed. Each finding names
 * a broken leg of the machine (discovery, movement, outreach), says what the
 * customer is losing while it stays broken, and links the fix.
 */
export function PipelinePulse({ findings }: { findings: PulseFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="space-y-3">
      {findings.map((f) => (
        <div
          key={f.key}
          className={
            f.severity === "down"
              ? "rounded-md border border-risk/40 bg-risk/10 px-4 py-3 text-sm"
              : "rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
          }
        >
          <p className={f.severity === "down" ? "font-semibold text-risk" : "font-semibold"}>
            {f.title}
          </p>
          <p className="mt-1 text-muted-foreground">{f.detail}</p>
          <p className="mt-2">
            <Link href={f.href} className="font-medium underline">
              {f.cta}
            </Link>
          </p>
        </div>
      ))}
    </div>
  );
}
