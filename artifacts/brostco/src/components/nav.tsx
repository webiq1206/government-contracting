import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

const NAV: { section: string; items: { href: string; label: string }[] }[] = [
  {
    section: "Pipeline",
    items: [
      { href: "/pipeline", label: "Pipeline" },
      { href: "/call-queue", label: "Call Queue" },
      { href: "/review", label: "Review Queue" },
    ],
  },
  {
    section: "Records",
    items: [
      { href: "/subs", label: "Sub Database" },
      { href: "/contracts", label: "Active Contracts" },
      { href: "/compliance", label: "Compliance" },
    ],
  },
  {
    section: "Intelligence",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/agents", label: "Agents & Logs" },
    ],
  },
  {
    section: "Settings",
    items: [
      { href: "/settings/profile", label: "Company Profile" },
      { href: "/settings/integrations", label: "Integrations" },
    ],
  },
];

interface NavProps {
  reviewCount?: number;
  callCount?: number;
}

function Wordmark() {
  return (
    <div>
      <span className="font-serif text-2xl font-semibold tracking-tight text-foreground">
        BROSTCO
      </span>
      <p className="eyebrow mt-1">Procurement Execution</p>
    </div>
  );
}

export function Nav({ reviewCount = 0, callCount = 0 }: NavProps) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  return (
    <>
      {/* Mobile bar */}
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 md:hidden">
        <span className="font-serif text-xl font-semibold text-foreground">BROSTCO</span>
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-label="menu">
          ☰
        </button>
      </div>

      <nav
        className={`${
          open ? "block" : "hidden"
        } w-full shrink-0 border-b border-border bg-background md:sticky md:top-0 md:block md:h-screen md:w-64 md:border-b-0 md:border-r`}
      >
        <div className="hidden px-6 py-6 md:block">
          <Wordmark />
        </div>

        <div className="space-y-5 p-3 md:px-4">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="eyebrow mb-1.5 px-2 text-[0.62rem]">{group.section}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    location === item.href || location.startsWith(item.href + "/");
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
                            : "border-transparent text-slate-400 hover:border-border-strong hover:text-foreground"
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

        <div className="border-t border-border p-4 md:absolute md:bottom-0 md:w-64">
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
          <button onClick={handleLogout} className="btn-ghost mt-2 w-full text-xs">
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
