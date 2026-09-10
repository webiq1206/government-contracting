import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { ReadOnlyBanner } from "@/components/permission-gate";
import { RecapSettingsForm } from "@/components/recap-settings-form";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";
import { systemMail } from "@/lib/integrations/system-mail";
import { getRecapSettings } from "@/lib/recap/settings";
import { orgMembersForRecap, recapRecipients } from "@/lib/recap/recipients";
import { deliveryHistory } from "@/lib/recap/delivery";
import { ShellDataWarning } from "@/components/shell-data-warning";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";

export const dynamic = "force-dynamic";

/**
 * Settings → Daily recap.
 *
 * Readable at every role and editable behind `manage_rules`, the same line the
 * automation rules draw: these settings decide what other people receive at
 * six in the morning, so changing them is an account-wide act, but knowing
 * what your account has decided is part of understanding it.
 */
export default async function RecapSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/settings");

  const orgId = user.organizationId;
  const loadWarnings: string[] = [];
  let settingsUnavailable = false;
  const settings = await getRecapSettings(orgId).catch(() => {
    settingsUnavailable = true;
    loadWarnings.push(
      "The recap schedule could not be loaded. Defaults are shown only as a preview; reload before saving or relying on delivery."
    );
    return { ...DEFAULT_RECAP_SETTINGS };
  });
  let recipientsUnavailable = false;
  const [members, recipients, history, mailReady] = await Promise.all([
    orgMembersForRecap(orgId).catch(() => {
      loadWarnings.push("Account members and their recap preferences could not be loaded.");
      return [];
    }),
    settingsUnavailable
      ? Promise.resolve([])
      : recapRecipients(orgId, settings).catch(() => {
          recipientsUnavailable = true;
          loadWarnings.push("The current recap recipient list could not be confirmed.");
          return [];
        }),
    deliveryHistory({ orgId, scope: "org", limit: 30, includeTests: true }).catch(() => {
      loadWarnings.push("Recent recap delivery history could not be loaded.");
      return [];
    }),
    systemMail.deliverable().catch(() => {
      loadWarnings.push("The recap sending mailbox could not be checked.");
      return false;
    }),
  ]);

  const receiving = new Set(recipients.map((r) => r.userId));
  const editable = !user.impersonatedBy && can(user.orgRole, "manage_rules");

  return (
    <>
      <PageFrame
        title="Daily Recap"
        explanation="The morning email summarising the day before: whether it goes out, what is in it, who receives it, and what counts as urgent."
        breadcrumbs={[{ label: "Settings", href: "/settings" }]}
        status={
          settingsUnavailable
            ? "Settings unavailable"
            : !settings.enabled
            ? "Turned off"
            : recipientsUnavailable
              ? "On, recipient status unavailable"
            : recipients.length === 0
              ? "On, but nobody is receiving it"
              : `On, ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`
        }
        primaryAction={
          <Link href="/recap" className="btn-secondary text-xs">
            Open the recap page
          </Link>
        }
      />
      <ShellDataWarning items={loadWarnings} />
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        <ReadOnlyBanner
          role={user.orgRole}
          capability="manage_rules"
          what="the daily recap settings"
        />
        <RecapSettingsForm
          initial={settings}
          readOnly={!editable || settingsUnavailable}
          mailReady={mailReady}
          members={members.map((m) => ({
            userId: m.userId,
            email: m.email,
            name: m.name,
            role: m.orgRole,
            timezone: m.timezone,
            timezoneIsDefault: m.timezoneIsDefault,
            optedOut: m.optedOut,
            receiving: receiving.has(m.userId),
          }))}
          history={history.map((h) => ({
            id: h.id,
            localDate: h.localDate,
            recipientEmail: h.recipientEmail,
            timezone: h.timezone,
            status: h.status,
            late: h.late,
            quiet: h.quiet,
            test: h.test,
            sentAt: h.sentAt,
            attempts: h.attempts,
            urgentCount: h.urgentCount,
            subject: h.subject,
            error: h.error,
            createdAt: h.createdAt,
          }))}
        />
      </div>
    </>
  );
}
