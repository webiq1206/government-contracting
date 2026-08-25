import { PageFrame } from "@/components/page-frame";
import { ReadOnlyBanner } from "@/components/permission-gate";
import { PAGE_HELP } from "@/lib/help-content";
import { getAutomationRules } from "@/lib/app-settings";
import { AutomationRulesForm } from "@/components/automation-rules-form";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";

export const dynamic = "force-dynamic";

/**
 * Settings → Automation rules: the guardrails that keep the pipeline clean,
 * deadline colors, the minimum lead-time intake gate, and archive retention.
 * Enforcement lives in the scoring engine and the maintenance sweeps; this
 * page only edits the shared config (app_settings) they all read.
 *
 * Readable at every role, editable by admins and owners. These rules change
 * how everyone's work behaves, which is the line where a mistake stops being
 * one bid and starts being the account -- but knowing what they say is part of
 * understanding your own account, so the page is not hidden.
 */
export default async function RulesPage() {
  const [rules, user] = await Promise.all([
    getAutomationRules(),
    currentUser().catch(() => null),
  ]);
  const editable = can(user?.orgRole, "manage_rules");
  return (
    <>
      <PageFrame
        help={PAGE_HELP["rules"]}
        title="Automation Rules"
        explanation="The guardrails every agent obeys: deadline warnings, the minimum lead time to take a job on, whether the pipeline places calls, and how long archives are kept."
        breadcrumbs={[{ label: "Settings", href: "/settings" }]}
        status={editable ? "Changes apply everywhere the moment you save" : "Read-only for your role"}
      />
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        <ReadOnlyBanner role={user?.orgRole} capability="manage_rules" what="the automation rules" />
        <AutomationRulesForm initial={rules} readOnly={!editable} />
      </div>
    </>
  );
}
