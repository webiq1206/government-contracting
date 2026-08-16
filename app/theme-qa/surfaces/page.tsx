import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Surface ladder lab",
  description: "Development-only check that no section blends into the page.",
  robots: { index: false, follow: false },
};

/**
 * The surface ladder, end to end. Every step has to be visibly separate from
 * the one under it in BOTH themes; that is the whole point of the class set,
 * and it is the thing that is impossible to confirm by reading CSS. Dev only.
 */
export default function SurfacesLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="eyebrow">Theme QA</p>
      <h1 className="mb-6 font-display text-lg">Surface ladder</h1>

      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Page background → panel → inset, and card → inset. If any two steps
          look the same, the sweep is not done.
        </p>

        {/* A Today-style section: content directly inside a panel. */}
        <details open className="panel group px-4 py-3 sm:px-5 sm:py-4">
          <summary className="flex cursor-pointer list-none items-end justify-between gap-3 border-b border-border/55 pb-3 dark:border-white/15 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="eyebrow-gold">Keep things moving</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground">
                Calls to make
                <span className="num ml-2 text-base font-normal text-muted-foreground">
                  (393 items)
                </span>
              </h2>
            </div>
            <span aria-hidden className="mb-1 text-lg text-gold">
              +
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-foreground/45">
              Each row opens that call&rsquo;s guided workspace.
            </p>
            <div className="panel-inset p-3">
              <p className="text-sm font-medium text-foreground">
                Hawaii Air Conditioning
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A row inside the section. This is `panel-inset` on `panel`.
              </p>
            </div>
            <div className="panel-inset p-3">
              <p className="text-sm font-medium text-foreground">
                Call Coastal Pipeline Products Corp
              </p>
            </div>
          </div>
        </details>

        {/* A card with an inset row, the other common nesting. */}
        <div className="card">
          <p className="eyebrow mb-3">A card</p>
          <p className="text-sm text-muted-foreground">
            Cards keep their own surface; rows inside them lift again.
          </p>
          <ul className="mt-3 space-y-2">
            <li className="panel-inset flex items-center justify-between px-3 py-2">
              <span className="text-sm text-foreground">Mobilize</span>
              <span className="badge bg-pursue/15 text-pursue">complete</span>
            </li>
            <li className="panel-inset flex items-center justify-between px-3 py-2">
              <span className="text-sm text-foreground">Rough-in</span>
              <span className="badge bg-review/15 text-review">in progress</span>
            </li>
          </ul>
        </div>

        {/* Raw swatches, so a regression in the tokens themselves is visible. */}
        <div className="panel p-4">
          <p className="eyebrow mb-3">Tokens</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["background", "bg-background"],
              ["surface", "bg-surface"],
              ["surface-raised", "bg-surface-raised"],
              ["shell", "bg-shell"],
            ].map(([name, cls]) => (
              <div key={name} className="text-center">
                <div className={`h-14 rounded-md border border-border/75 ${cls} dark:border-white/[0.17]`} />
                <p className="mt-1 text-[0.65rem] text-muted-foreground">{name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
