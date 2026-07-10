"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const NAV: { section: string; items: { href: string; label: string }[] }[] = [
  {
    section: "Start here",
    items: [
      { href: "/today", label: "Today" },
      { href: "/how-it-works", label: "How it works" },
    ],
  },
  {
    section: "Work the pipeline",
    items: [
      { href: "/pipeline", label: "Pipeline" },
      { href: "/review", label: "Review Queue" },
      { href: "/call-queue", label: "Call Queue" },
    ],
  },
  {
    section: "Records",
    items: [
      { href: "/subs", label: "Subcontractors" },
      { href: "/contracts", label: "Contracts" },
      { href: "/compliance", label: "Compliance" },
    ],
  },
  {
    section: "Insight",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/agents", label: "Automation Log" },
    ],
  },
  {
    section: "Settings",
    items: [
      { href: "/settings/profile", label: "Company Profile" },
      { href: "/settings/content", label: "Content Library" },
      { href: "/settings/integrations", label: "Integrations" },
    ],
  },
];

export function Nav({
  email,
  reviewCount,
  callCount,
}: {
  email: string;
  reviewCount: number;
  callCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 md:hidden">
        <span className="font-serif text-xl font-semibold text-foreground">BROSTCO</span>
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-label="menu">
          ☰
        </button>
      </div>

      <nav
        className={`${
          open ? "block" : "hidden"
        } w-full shrink-0 border-b border-border bg-background md:sticky md:top-0 md:flex md:h-screen md:w-64 md:flex-col md:border-b-0 md:border-r`}
      >
        <div className="hidden shrink-0 px-6 py-6 md:block">
          <span className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            BROSTCO
          </span>
          <p className="eyebrow mt-1">Procurement Execution</p>
        </div>

        <div className="scroll-thin space-y-5 p-3 md:flex-1 md:overflow-y-auto md:px-4">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="eyebrow mb-1.5 px-2 text-[0.62rem] font-bold text-slate-500">
                {group.section}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  const badge =
                    item.href === "/review"
                      ? reviewCount
                      : item.href === "/call-queue"
                        ? callCount
                        : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`flex items-center justify-between border-l-2 py-1.5 pl-3 pr-2 text-sm transition-colors ${
                          active
                            ? "border-accent bg-accent-soft font-medium text-accent-strong"
                            : "border-transparent text-slate-600 hover:border-border-strong hover:text-foreground"
                        }`}
                      >
                        <span>{item.label}</span>
                        {badge > 0 && (
                          <span className="badge bg-accent-soft text-accent">{badge}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <p className="truncate text-xs text-slate-500">{email}</p>
          <button onClick={logout} className="btn-ghost mt-2 w-full text-xs">
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
