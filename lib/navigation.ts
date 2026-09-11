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
  /** Platform-owner tools, hidden from customers entirely. */
  adminOnly?: boolean;
}

/**
 * The sections, in the order a working day tends to move through them.
 *
 * Names describe the job rather than the software: "Delivery" is what happens
 * after you win, "Performance" is how it went. A contractor should be able to
 * find a page from the noun in their head.
 */
export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    key: "work",
    label: "Work",
    items: [
      { href: "/today", label: "Today", hint: "Everything that needs you" },
      {
        href: "/workbench",
        label: "My Work",
        hint: "Work the whole queue on one screen",
      },
      { href: "/pipeline", label: "Opportunities", hint: "Every opportunity, by whose turn it is" },
      { href: "/review", label: "Review", hint: "Borderline opportunities to pursue or pass", badge: "review" },
      { href: "/call-queue", label: "Calls", hint: "Work calls one after another", badge: "calls" },
    ],
  },
  {
    key: "relationships",
    label: "Relationships",
    items: [
      { href: "/subs", label: "Subcontractors" },
      { href: "/communications", label: "Inbox" },
    ],
  },
  {
    key: "delivery",
    label: "Delivery",
    items: [
      { href: "/contracts", label: "Contracts" },
      { href: "/compliance", label: "Compliance" },
    ],
  },
  {
    key: "performance",
    label: "Insights",
    items: [
      {
        href: "/recap",
        label: "Daily recap",
        hint: "What happened yesterday, urgent things first",
      },
      { href: "/activity", label: "Activity", hint: "Every recorded action, message and result" },
      { href: "/analytics", label: "Reports" },
      { href: "/agents", label: "Automation", hint: "Whether the automation is working, and what is stopping it" },
    ],
  },
  {
    key: "help",
    label: "Help",
    // Guide Me is a panel rather than a page -- it opens over whatever you are
    // looking at, because its whole value is knowing where you are. Listing it
    // as a destination here would be a link that navigates nowhere.
    items: [
      { href: "/how-it-works", label: "Help center" },
      // Every role can reach this, including the read-only ones. Somebody
      // looking at a figure that does not add up is the person who should be
      // able to say so, and there was previously nowhere to say it.
      {
        href: "/feedback",
        label: "Feedback",
        hint: "Something broken, a number that reads wrong, or a thing this should do",
      },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { href: "/settings/profile", label: "Company" },
      { href: "/settings/rules", label: "Rules" },
      { href: "/settings/content", label: "Content" },
      { href: "/settings/integrations", label: "Connections" },
      { href: "/settings/api-usage", label: "AI usage" },
      { href: "/settings/billing", label: "Billing" },
      { href: "/settings/recap", label: "Daily recap" },
      // Which alerts reach this account by email and which live only in the
      // product. Worth its own entry because the answer is surprising.
      { href: "/settings/notifications", label: "Notifications" },
      /*
       * Last in the section and named for the person rather than the company,
       * because everything above it is organization-wide and this one is not.
       * It is also the only place to change your own password without
       * declaring you have lost it.
       */
      { href: "/settings/account", label: "Your account" },
    ],
  },
  {
    key: "platform",
    label: "Platform admin",
    adminOnly: true,
    items: [
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/invitations", label: "Invitations" },
      { href: "/admin/billing", label: "Customer billing" },
      { href: "/admin/api-usage", label: "AI usage" },
      // Its own entry rather than fifteen rows at the foot of Accounts. The
      // record of what we did to somebody's account is a different question
      // from which account is in trouble, and it is the one somebody comes
      // looking for months later.
      { href: "/admin/audit", label: "Audit log" },
      // Platform-wide, as against the per-account Automation Health under
      // Delivery. An outage affecting every customer used to be findable only
      // by opening accounts one at a time until a pattern appeared.
      { href: "/admin/health", label: "System health" },
      { href: "/admin/recap", label: "Platform recap" },
    ],
  },
  {
    key: "optional",
    label: "Optional tools",
    /*
     * Site Authority tracks OUR marketing domain's backlinks. It is
     * meaningless to a contractor and a window onto our own business, so it
     * stays admin-only and in its own group rather than sitting among the
     * pages a customer works in.
     */
    adminOnly: true,
    items: [{ href: "/authority", label: "Site Authority" }],
  },
];


/** Record pages retain their parent destination; aliases share one selection. */
export function navigationMatches(pathname: string, href: string): boolean {
  if (href === "/pipeline" && (pathname === "/opportunities" || pathname.startsWith("/opportunity/"))) return true;
  if (href === "/agents" && pathname === "/automation") return true;
  if (href === "/communications" && pathname === "/email-log") return true;
  return pathname === href || pathname.startsWith(href + "/");
}

export function mobileDestination(pathname: string): string {
  for (const href of ["/today", "/pipeline", "/subs", "/call-queue"]) {
    if (navigationMatches(pathname, href)) return href;
  }
  return "/more";
}

export const SETTINGS_DESTINATIONS = NAVIGATION_SECTIONS.find(section => section.key === "settings")!.items;

export function recordParent(path: string): { href: string; label: string } | null {
  if (path.startsWith("/opportunity/")) return { href: "/pipeline", label: "Opportunities" };
  if (path.startsWith("/subs/")) return { href: "/subs", label: "Subcontractors" };
  if (path.startsWith("/contracts/")) return { href: "/contracts", label: "Contracts" };
  if (path.startsWith("/admin/accounts/")) return { href: "/admin/accounts", label: "Accounts" };
  return null;
}
