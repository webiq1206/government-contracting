import { SettingsNav } from "@/components/settings-nav";

/**
 * Shared chrome for all dash settings pages: sticky section tabs, then the
 * page header and content from each route.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex page-shell">
      <SettingsNav />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
