"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import type { AdminAccountRow } from "@/lib/admin/accounts";
import { AdminAccountPeek } from "@/components/admin/account-peek";
import { shouldRunPlainKey } from "@/lib/domain/keyboard";

/** A read-only peek uses the rows already authorized and loaded for this page.
 * Native history keeps bookmarks and Back without fetching the same list again. */
export function AccountQuickViews({ rows, children }: { rows: AdminAccountRow[]; children: ReactNode }) {
  const search = useSearchParams();
  const selected = rows.findIndex(row => row.id === search.get("peek"));
  const href = (id: string | null) => {
    const params = new URLSearchParams(search.toString());
    params.delete("peek");
    if (id) params.set("peek", id);
    return "/admin/accounts" + (params.size ? "?" + params.toString() : "");
  };
  const navigate = (target: string) => {
    if (target !== window.location.pathname + window.location.search) window.history.pushState(null, "", target);
  };
  const prevHref = selected > 0 ? href(rows[selected - 1].id) : null;
  const nextHref = selected >= 0 && selected < rows.length - 1 ? href(rows[selected + 1].id) : null;
  return <div className="flex min-h-0 flex-1 overflow-hidden"
    onClickCapture={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || target.pathname !== "/admin/accounts" || target.hash) return;
      const current = new URLSearchParams(window.location.search);
      const incoming = new URLSearchParams(target.search);
      const id = incoming.get("peek");
      if (id && !rows.some(row => row.id === id)) return;
      if (id === current.get("peek")) return;
      current.delete("peek"); incoming.delete("peek"); current.sort(); incoming.sort();
      if (current.toString() !== incoming.toString()) return;
      event.preventDefault(); event.stopPropagation();
      navigate(target.pathname + target.search);
    }}
    onKeyDown={event => {
      if (event.defaultPrevented || !shouldRunPlainKey(event, event.target as HTMLElement)) return;
      const destination = /^(j|J|ArrowDown)$/.test(event.key) ? nextHref : /^(k|K|ArrowUp)$/.test(event.key) ? prevHref : null;
      if (destination) { event.preventDefault(); navigate(destination); }
    }}>
    <Suspense fallback={null}>{children}</Suspense>
    {selected >= 0 && <AdminAccountPeek account={rows[selected]} closeHref={href(null)} navigate={navigate}
      nav={{ prevHref, nextHref, index: selected, total: rows.length }} />}
  </div>;
}
