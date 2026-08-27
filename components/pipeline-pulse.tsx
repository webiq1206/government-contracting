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
