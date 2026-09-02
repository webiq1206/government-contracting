"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Account controls that used to live only in the phone header and the
 * hamburger. Theme and sign-out belong on More, the same way they sit at
 * the foot of the desktop sidebar.
 */
export function MoreAccount({ email }: { email: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        setLogoutError("Could not sign out. Check your connection and try again.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setLogoutError("Could not sign out. Check your connection and try again.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <section aria-labelledby="more-account">
      <h2 id="more-account" className="label mb-2">
        Your session
      </h2>
      <div className="space-y-3 rounded-md border border-border/55 p-3 dark:border-white/10">
        <ThemeToggle className="w-full justify-stretch [&>button]:flex-1" />
        <p className="truncate text-xs text-muted-foreground">{email}</p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-guide-wizard"))}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border/55 px-3 text-sm text-foreground transition-colors hover:border-gold/40 hover:bg-gold/10 dark:border-white/10"
        >
          <span aria-hidden className="text-gold-text">
            ?
          </span>
          Guide Me
        </button>
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border/55 px-3 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-60 dark:border-white/10"
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
        {logoutError && (
          <p role="alert" className="text-xs text-risk">
            {logoutError}
          </p>
        )}
      </div>
    </section>
  );
}
