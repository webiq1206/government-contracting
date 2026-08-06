import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { getAutomationRules } from "@/lib/app-settings";
import { AutomationRulesForm } from "@/components/automation-rules-form";

export const dynamic = "force-dynamic";

/**
 * Settings → Automation rules: the guardrails that keep the pipeline clean,
 * deadline colors, the minimum lead-time intake gate, and archive retention.
 * Enforcement lives in the scoring engine and the maintenance sweeps; this
 * page only edits the shared config (app_settings) they all read.
 */
export default async function RulesPage() {
  const rules = await getAutomationRules();
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        help={PAGE_HELP["rules"]}
        title="Automation Rules"
        subtitle="Guardrails that keep the pipeline clean: deadline warnings, lead-time limits, and cleanup. Changes apply everywhere the moment you save."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-4xl">
          <AutomationRulesForm initial={rules} />
        </div>
      </div>
    </div>
  );
}
