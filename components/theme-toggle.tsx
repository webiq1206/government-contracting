"use client";
import { useTheme } from "@/components/theme-provider";

/** In-flow, touch-sized theme switch; never floats over page content. */
export function ThemeToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <button type="button" aria-label={label} title={label}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/55 bg-muted/50 text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <svg width={compact ? 18 : 20} height={compact ? 18 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {theme === "dark" ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20.5 13.2A8.7 8.7 0 0 1 10.8 3.5a8.8 8.8 0 1 0 9.7 9.7Z"/>}
        </svg>
      </button>
    </span>
  );
}
