import { SettingsNav } from "@/components/settings-nav";

/**
 * Settings chrome for account-layout routes (billing) so the same tab bar
 * appears whether the user is fully subscribed or mid-checkout.
 */
export default function AccountSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex page-shell min-h-0 flex-1 flex-col">
      <SettingsNav />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
