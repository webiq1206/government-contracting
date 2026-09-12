export interface NavigationItem {
  href: string;
  label: string;
  hint?: string;
  badge?: "review" | "calls";
}

export interface NavigationSection {
  key: string;
  label: string;
  items: NavigationItem[];
  adminOnly?: boolean;
}

/**
 * Global navigation is deliberately small. Review and Calls remain fully
 * supported routes, but they are work views reached from Today/My Work rather
 * than equal-weight destinations in the global shell.
 */
export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    key: "primary",
    label: "Workspace",
    items: [
      { href: "/today", label: "Today" },
      { href: "/pipeline", label: "Opportunities" },
      { href: "/workbench", label: "My Work" },
      { href: "/subs", label: "Subcontractors" },
      { href: "/communications", label: "Inbox" },
    ],
  },
  {
    key: "manage",
    label: "Manage",
    items: [
      { href: "/contracts", label: "Contracts" },
      { href: "/compliance", label: "Compliance" },
    ],
  },
  {
    key: "insights",
    label: "Insights & system",
    items: [
      { href: "/activity", label: "Activity" },
      { href: "/analytics", label: "Reports" },
      { href: "/recap", label: "Daily recap" },
      { href: "/agents", label: "Automation" },
    ],
  },
  {
    key: "utility",
    label: "Account",
    items: [
      { href: "/settings/profile", label: "Settings" },
      { href: "/how-it-works", label: "Help" },
      { href: "/feedback", label: "Feedback" },
    ],
  },
  {
    key: "platform",
    label: "Admin",
    adminOnly: true,
    items: [
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/health", label: "System health" },
      { href: "/admin/audit", label: "Audit log" },
      { href: "/admin/billing", label: "Customer billing" },
      { href: "/admin/api-usage", label: "AI usage" },
      { href: "/admin/invitations", label: "Invitations" },
      { href: "/admin/recap", label: "Platform recap" },
      { href: "/authority", label: "Site Authority" },
    ],
  },
];

/** Settings keep direct routes without flooding the global navigation. */
export const SETTINGS_DESTINATIONS: NavigationItem[] = [
  { href: "/settings/profile", label: "Company" },
  { href: "/settings/rules", label: "Rules" },
  { href: "/settings/content", label: "Content" },
  { href: "/settings/integrations", label: "Connections" },
  { href: "/settings/api-usage", label: "AI usage" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/recap", label: "Daily recap" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/account", label: "Your account" },
];

/** Record pages retain their parent destination; aliases share one selection. */
export function navigationMatches(pathname: string, href: string): boolean {
  if (href === "/pipeline" && (pathname === "/opportunities" || pathname.startsWith("/opportunity/") || pathname === "/review")) return true;
  if (href === "/workbench" && pathname === "/call-queue") return true;
  if (href === "/agents" && pathname === "/automation") return true;
  if (href === "/communications" && pathname === "/email-log") return true;
  if (href === "/settings/profile" && pathname.startsWith("/settings/")) return true;
  return pathname === href || pathname.startsWith(href + "/");
}

/** Kept for compatibility with older links. The persistent mobile tab bar is no longer used. */
export function mobileDestination(pathname: string): string {
  for (const href of ["/today", "/pipeline", "/workbench", "/subs", "/communications"]) {
    if (navigationMatches(pathname, href)) return href;
  }
  return "/settings/profile";
}

export function recordParent(path: string): { href: string; label: string } | null {
  if (path.startsWith("/opportunity/")) return { href: "/pipeline", label: "Opportunities" };
  if (path.startsWith("/subs/")) return { href: "/subs", label: "Subcontractors" };
  if (path.startsWith("/contracts/")) return { href: "/contracts", label: "Contracts" };
  if (path.startsWith("/admin/accounts/")) return { href: "/admin/accounts", label: "Accounts" };
  return null;
}
