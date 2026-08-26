import Link from "next/link";
import { NextResponse } from "next/server";
import { PageFrame } from "@/components/page-frame";
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
const GROUPS: {
  title: string;
  items: { href: string; label: string; hint: string }[];
  adminOnly?: boolean;
}[] = [
  {
    title: "Work",
    items: [
      { href: "/review", label: "Review", hint: "Borderline opportunities to pursue or pass" },
      { href: "/call-queue", label: "Call Queue", hint: "Work calls one after another" },
    ],
  },
  {
    title: "Delivery",
    items: [
      { href: "/contracts", label: "Contracts", hint: "Awarded work, from setup to closeout" },
      { href: "/compliance", label: "Compliance", hint: "Registrations, certificates and deadlines" },
    ],
  },
  {
    title: "Performance",
    items: [
      { href: "/analytics", label: "Analytics", hint: "What the pipeline is actually producing" },
      { href: "/agents", label: "Automation Health", hint: "Whether the automation is working, and what is stopping it" },
    ],
  },
  {
    title: "Help",
    items: [{ href: "/how-it-works", label: "Knowledge Center", hint: "How each part of this works" }],
  },
  {
    title: "Settings",
    items: [
      { href: "/settings/profile", label: "Company", hint: "What the scoring is matching against" },
      { href: "/settings/rules", label: "Rules", hint: "Guardrails for the automation" },
      { href: "/settings/content", label: "Content", hint: "The emails and proposal language reused across bids" },
      { href: "/settings/integrations", label: "Integrations", hint: "The services this runs on" },
      { href: "/settings/billing", label: "Billing", hint: "Your plan and invoices" },
    ],
  },
  {
    title: "Platform Admin",
    adminOnly: true,
    items: [
      { href: "/admin/accounts", label: "Accounts", hint: "Every customer account" },
      { href: "/admin/invitations", label: "Invitations", hint: "Outstanding invitations" },
      { href: "/admin/billing", label: "Customer Billing", hint: "Subscriptions and payments" },
    ],
  },
];

export default async function MorePage() {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
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
        explanation="The rest of the product, grouped the way the sidebar groups it on a wider screen."
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-4">
        {GROUPS.filter((g) => !g.adminOnly || admin).map((g) => (
          <section key={g.title}>
            <h2 className="label mb-2">{g.title}</h2>
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
          </section>
        ))}
      </div>
    </div>
  );
}
