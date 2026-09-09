import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { PendingLink as Link } from "@/components/pending-link";
import { NAVIGATION_SECTIONS } from "@/lib/navigation";
import { NextResponse } from "next/server";
import { PageFrame } from "@/components/page-frame";
import { MoreAccount } from "@/components/more-account";
import { requireOrgContext } from "@/lib/org-guard";
import { isPlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

/**
 * Everything the five bottom tabs do not hold.
 *
 * The audit's mobile shell says "no desktop sidebar", and the navigation
 * drawer was the desktop sidebar wearing a different coat: the only way to
 * reach Contracts, Compliance, Analytics, Automation Health, the Knowledge
 * Center, Settings or Platform Admin on a phone was to open it and scroll.
 *
 * Desktop never links here -- the bottom bar that points at it is itself
 * phone-only -- but the page still renders at any width. Hiding it with a
 * media query meant a direct visit or a bookmark showed a blank screen, which
 * is a worse answer than a list of links somebody did not need.
 */
const QUICK_DESTINATIONS = new Set(["/today", "/pipeline", "/subs", "/call-queue"]);
const GROUPS = NAVIGATION_SECTIONS.map(group => ({
  ...group,
  items: group.items.filter(item => !QUICK_DESTINATIONS.has(item.href)),
})).filter(group => group.items.length > 0);

export default async function MorePage() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  /*
   * Impersonation does not confer platform admin, the same rule the sidebar
   * uses. Support looking at a customer's account is not the same as support
   * having the platform's own controls while inside it.
   */
  const admin = !ctx.user.impersonatedBy && isPlatformAdmin(ctx.user.email);

  return (
    <div className="flex page-shell">
      <PageFrame
        title="More"
        status="Everything not on the bottom bar"
        explanation="Workbench, Review, messages, settings, and the rest of the product."
      />
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
        {GROUPS.filter((g) => !g.adminOnly || admin).map((g) => (
          <details key={g.key} open={g.key === "work" || g.key === "relationships" || g.key === "performance"} className="rounded-lg border border-border bg-surface p-4">
            <summary className="cursor-pointer py-2 text-sm font-semibold">{g.label}</summary>
            <ul className="space-y-2">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className="block rounded-md border border-border/55 px-3 py-3 transition-colors hover:border-foreground/30 dark:border-white/10"
                  >
                    <span className="block text-sm font-medium text-foreground">{i.label}</span>
                    <span className="block text-xs text-slate-500">{i.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
        <MoreAccount email={ctx.user.email} />
      </div>
    </div>
  );
}
