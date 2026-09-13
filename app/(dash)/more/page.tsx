import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { PendingLink as Link } from "@/components/pending-link";
import { workspaceSections, SETTINGS_DESTINATIONS } from "@/lib/navigation";
import { NextResponse } from "next/server";
import { PageFrame } from "@/components/page-frame";
import { MoreAccount } from "@/components/more-account";
import { requireOrgContext } from "@/lib/org-guard";
import { isPlatformAdmin } from "@/lib/platform-admin";
export const dynamic = "force-dynamic";

export default async function MorePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  const admin = !ctx.user.impersonatedBy && isPlatformAdmin(ctx.user.email);
  const sections = workspaceSections(admin);
  const params = await searchParams;
  const requested = typeof params?.section === "string" ? params.section : "manage";
  const active = sections.find(section => section.key === requested) ?? sections[0];
  const items = active.key === "utility" ? SETTINGS_DESTINATIONS : active.items;
  return <div className="page-shell">
    <PageFrame title="Workspace" explanation="Tools and settings, when you need them." breadcrumbs={[{label:"Today",href:"/today"},{label:"Workspace"}]} />
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 pb-10 pt-4 sm:px-6">
      <nav aria-label="Workspace sections" className="flex flex-wrap gap-2">
        {sections.map(section => <Link key={section.key} href={`/more?section=${section.key}`} aria-current={section.key === active.key ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm ${section.key === active.key ? "bg-accent-soft font-semibold text-accent" : "text-muted-foreground hover:bg-muted"}`}>{section.label === "Insights & system" ? "Insights" : section.label}</Link>)}
      </nav>
      <section aria-label={active.label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(item => <Link key={item.href} href={item.href} className="rounded-2xl border border-border/60 bg-surface p-5 transition-colors hover:border-accent">
          <span className="flex items-center justify-between gap-3 text-base font-semibold">{item.label}<span aria-hidden className="text-muted-foreground">↗</span></span>
          {item.hint && <span className="mt-2 block text-sm text-muted-foreground">{item.hint}</span>}
        </Link>)}
      </section>
      {active.key === "utility" && <>
        <div className="flex flex-wrap gap-4"><Link href="/how-it-works" className="min-h-11 text-sm text-accent underline">Help</Link><Link href="/feedback" className="min-h-11 text-sm text-accent underline">Send feedback</Link></div>
        <MoreAccount email={ctx.user.email} />
      </>}
    </div>
  </div>;
}
