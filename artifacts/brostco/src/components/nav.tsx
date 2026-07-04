import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/pipeline", label: "Pipeline", icon: "▦" },
  { href: "/call-queue", label: "Call Queue", icon: "☎" },
  { href: "/review", label: "Review Queue", icon: "⚑" },
  { href: "/subs", label: "Sub Database", icon: "⚒" },
  { href: "/analytics", label: "Analytics", icon: "📈" },
  { href: "/compliance", label: "Compliance", icon: "✔" },
  { href: "/contracts", label: "Active Contracts", icon: "▣" },
  { href: "/agents", label: "Agents & Logs", icon: "◈" },
  { href: "/settings/profile", label: "Company Profile", icon: "⚙" },
  { href: "/settings/integrations", label: "Integrations", icon: "🔌" },
];

interface NavProps {
  reviewCount?: number;
  callCount?: number;
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
      <div className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3 md:hidden">
        <span className="font-mono text-lg font-bold text-white">BROSTCO</span>
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-label="menu">☰</button>
      </div>
      <nav className={`${open ? "block" : "hidden"} w-full shrink-0 border-b border-ink-800 bg-ink-900 md:block md:h-screen md:w-60 md:border-b-0 md:border-r`}>
        <div className="hidden px-5 py-5 md:block">
          <span className="font-mono text-xl font-bold tracking-tight text-white">BROSTCO</span>
          <p className="mt-0.5 text-[11px] text-slate-500">Procurement Execution</p>
        </div>
        <ul className="space-y-0.5 p-2">
          {NAV.map((item) => {
            const active = location === item.href || location.startsWith(item.href + "/");
            const badge = item.href === "/review" ? reviewCount : item.href === "/call-queue" ? callCount : 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    active ? "bg-brand-600/20 text-white" : "text-slate-300 hover:bg-ink-800"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-4 text-center text-xs opacity-70">{item.icon}</span>
                    {item.label}
                  </span>
                  {badge > 0 && <span className="badge bg-review/20 text-review">{badge}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-ink-800 p-3 md:absolute md:bottom-0 md:w-60">
          <p className="truncate px-2 text-xs text-slate-500">{user?.email}</p>
          <button onClick={handleLogout} className="btn-ghost mt-2 w-full text-xs">Sign out</button>
        </div>
      </nav>
    </>
  );
}
