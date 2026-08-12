import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { PageHeader, ScoreBadge, TierBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { DeadlineBadge } from "@/components/deadline-badge";
import { HelpPopover } from "@/components/help-popover";
import { TodayGreeting } from "@/components/today-greeting";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Theme surface lab",
  description:
    "Development-only Light and Dark theme surface checks for Brost Co product chrome.",
  robots: { index: false, follow: false },
};

/**
 * Development-only visual lab for Light / Dark product surfaces.
 * Mirrors dash chrome used on Today, Opportunities, Review, Call Queue, Settings.
 * Visit /theme-qa while `next dev` is running. Not available in production.
 */
export default function ThemeQaPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const sampleDeadline = new Date(Date.now() + 86400000 * 3).toISOString();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground md:flex-row">
      {/* Desktop sidebar mock */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/55 bg-background dark:border-white/10 md:flex">
        <div className="px-5 py-6">
          <ThemeWordmark className="h-7 w-auto" />
          <p className="mt-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </p>
        </div>
        <div className="space-y-1.5 px-4">
          <div className="rounded-md border border-border/55 bg-surface px-3 py-2 text-sm text-muted-foreground dark:border-white/15">
            Search…
          </div>
          <div className="rounded-md border border-border/55 px-3 py-2 text-sm text-muted-foreground dark:border-white/15">
            <span className="text-gold">?</span> Guide Me
          </div>
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 px-4 text-sm">
          {["Today", "Call Queue", "Opportunities", "Review"].map((label, i) => (
            <div
              key={label}
              className={`rounded-md px-3 py-2 ${
                i === 0
                  ? "bg-gold/15 font-medium text-gold"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </div>
          ))}
        </nav>
        <div className="space-y-3 border-t border-border/55 p-4 dark:border-white/10">
          <ThemeToggle className="w-full justify-stretch [&>button]:flex-1" />
          <p className="truncate text-xs text-muted-foreground">operator@brostco.com</p>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile header mock */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 px-3 dark:border-white/10 md:hidden">
          <ThemeWordmark className="h-6 w-auto" />
          <div className="flex-1" />
          <ThemeToggle compact />
          <span className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground">
            ☰
          </span>
        </header>

        <PageHeader
          title="Theme surface lab"
          subtitle="Product chrome samples for Today, Opportunities, Review, Call Queue, Opportunity, Subs, Settings, and Billing."
          help={{
            title: "What this page is for",
            points: [
              "Flip Light / Dark and check contrast on every surface below.",
              "Resize to phone width and confirm controls stay readable.",
              "This route is disabled in production builds.",
            ],
          }}
        />

        <main className="scroll-thin flex-1 overflow-y-auto px-4 py-6 pb-24 sm:px-6 md:pb-6">
          <div className="page-stack">
            <section className="space-y-4">
              <p className="eyebrow-gold">Today greeting</p>
              <TodayGreeting clear={false} actionCount={4} />
            </section>

            <section className="space-y-3">
              <p className="eyebrow-gold">Queue rows</p>
              <div className="card space-y-0 p-0">
                {[
                  "Facility maintenance IDIQ",
                  "IT help desk BPA",
                  "Janitorial services",
                ].map((title, i) => (
                  <div
                    key={title}
                    className={`flex flex-wrap items-center justify-between gap-3 px-4 py-4 ${
                      i < 2 ? "border-b border-border/55 dark:border-white/10" : ""
                    } ${i === 0 ? "focus-rail" : ""}`}
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-gold">
                        Deadline
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">{title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        GSA · waiting on you
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DeadlineBadge deadline={sampleDeadline} />
                      <ScoreBadge score={78 - i * 8} />
                      <button type="button" className="shell-ghost text-xs">
                        Open
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <p className="eyebrow-gold">Opportunities / Review cards</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[72, 58, 41].map((score) => (
                  <div key={score} className="card card-hover">
                    <p className="eyebrow mb-2 md:hidden">Next: gather quotes</p>
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium text-foreground">
                        Sample opportunity {score}
                      </p>
                      <ScoreBadge score={score} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <TierBadge tier={score >= 70 ? "pursue" : "review"} />
                      <DeadlineBadge deadline={sampleDeadline} showDate />
                      <span className="badge bg-muted text-muted-foreground">Automatic</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <p className="eyebrow-gold">Actions + forms</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary">
                  Primary
                </button>
                <button type="button" className="btn-secondary">
                  Secondary
                </button>
                <button type="button" className="btn-ghost">
                  Ghost
                </button>
                <button type="button" className="shell-ghost">
                  Shell ghost
                </button>
                <button type="button" className="btn-success">
                  Pursue
                </button>
                <button type="button" className="btn-danger">
                  Pass
                </button>
                <HelpPopover
                  help={{
                    title: "Help popover",
                    points: ["Should stay readable in both themes."],
                  }}
                />
              </div>
              <div className="card space-y-3">
                <label className="block">
                  <span className="label">Company name</span>
                  <input className="input mt-1" defaultValue="Example Contracting LLC" />
                </label>
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="th">Opportunity</th>
                      <th className="th">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="td">Facility maintenance</td>
                      <td className="td">Waiting on you</td>
                    </tr>
                    <tr>
                      <td className="td">IT support BPA</td>
                      <td className="td">In pursuit</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <EmptyState
              tone="success"
              title="You are clear for now"
              description="Empty and calm states should never invert into cream or ink islands."
              action={
                <button type="button" className="shell-ghost text-sm">
                  Browse opportunities
                </button>
              }
            />

            <section className="rounded-md border border-review/40 bg-review/10 px-4 py-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold">Paused banner sample.</span> Status strips must
                keep readable body text in both themes.
              </p>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="shell-panel p-5">
                <p className="eyebrow-gold">Pipeline health</p>
                <p className="mt-4 font-display text-5xl text-foreground">
                  <span className="num">24</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">active opportunities</p>
              </div>
              <div className="callout-panel">
                <p className="text-sm font-medium text-foreground">Billing / settings callout</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Soft accent panel used on profile, rules, and billing notices.
                </p>
              </div>
            </section>
          </div>
        </main>

        {/* Guide FAB mock (desktop) */}
        <button
          type="button"
          className="fixed z-[65] hidden items-center gap-2 rounded-md border border-gold/40 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-lg dark:bg-shell md:bottom-6 md:right-6 md:flex"
        >
          <span className="text-gold">?</span> Guide Me
        </button>

        {/* Mobile tab bar mock */}
        <nav className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-border/55 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 md:hidden">
          {["Today", "Calls", "Opportunities", "Review"].map((label, i) => (
            <div
              key={label}
              className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                i === 0 ? "font-semibold text-gold" : "text-muted-foreground"
              }`}
            >
              {label}
              {i === 0 && <span className="absolute inset-x-6 top-0 h-0.5 bg-gold" />}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
