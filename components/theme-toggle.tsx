"use client";

import { useTheme } from "@/components/theme-provider";

/**
 * Obvious Light / Dark control for the logged-in shell.
 * Renders as a compact segmented control that works in both themes.
 */
export function ThemeToggle({
  className = "",
  compact = false,
}: {
  className?: string;
  /** Tighter padding for the mobile header. */
  compact?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const pad = compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-1.5 text-xs";

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={`inline-flex items-stretch rounded-sm border border-border/55 bg-muted/50 p-0.5 dark:border-white/15 dark:bg-black/30 ${className}`}
    >
      <button
        type="button"
        aria-pressed={theme === "light"}
        onClick={() => setTheme("light")}
        className={`${pad} min-h-11 rounded-sm font-medium transition-colors lg:min-h-0 ${
          theme === "light"
            ? "bg-surface text-foreground shadow-sm ring-1 ring-border/80 dark:bg-surface-raised"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Light
      </button>
      <button
        type="button"
        aria-pressed={theme === "dark"}
        onClick={() => setTheme("dark")}
        className={`${pad} min-h-11 rounded-sm font-medium transition-colors lg:min-h-0 ${
          theme === "dark"
            ? "bg-surface text-foreground shadow-sm ring-1 ring-border/80 dark:bg-surface-raised dark:ring-white/20"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Dark
      </button>
    </div>
  );
}
