"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { PendingLink as Link } from "@/components/pending-link";
import { SETTINGS_DESTINATIONS, navigationMatches } from "@/lib/navigation";

export function SettingsNav() {
  const path = usePathname();
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const active = SETTINGS_DESTINATIONS.find((item) => navigationMatches(path, item.href));

  return (
    <div className="shrink-0 border-b border-border/60 bg-surface px-4 py-2 sm:px-6">
      <label className="flex max-w-md items-center gap-3 text-sm">
        <span className="font-medium">Settings</span>
        <select
          aria-label="Settings section"
          value={active?.href ?? ""}
          onChange={(event) => {
            // Reuse real navigation links so UnsavedGuard can intercept the
            // change before an editor's draft is lost, including on phones.
            const destination = event.currentTarget.value;
            event.currentTarget.value = active?.href ?? "";
            links.current.get(destination)?.click();
          }}
          className="input min-h-11 min-w-0 flex-1"
        >
          {SETTINGS_DESTINATIONS.map((item) => (
            <option key={item.href} value={item.href}>{item.label}</option>
          ))}
        </select>
      </label>
      <nav aria-label="Settings sections" className="hidden">
        {SETTINGS_DESTINATIONS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            ref={(element) => {
              if (element) links.current.set(item.href, element);
              else links.current.delete(item.href);
            }}
            aria-current={item.href === active?.href ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm ${item.href === active?.href ? "bg-accent-soft font-semibold text-accent" : "text-muted-foreground hover:bg-muted"}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
