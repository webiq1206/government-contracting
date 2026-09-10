import { PageFrame } from "@/components/page-frame";
import { ReadOnlyBanner } from "@/components/permission-gate";
import { can } from "@/lib/domain/roles";
import { currentUser } from "@/lib/auth";
import { PAGE_HELP } from "@/lib/help-content";
import { ContentLibraryManager } from "@/components/content-library-manager";
import { type EmailTemplate } from "@/components/email-template-editor";
import { TemplateWorkbench, type TemplateEntry } from "@/components/template-workbench";
import { EditorialTabs } from "@/components/editorial-tabs";
import { contentLibrary, templateSendStats } from "@/lib/data";
import { templateMetrics } from "@/lib/domain/template-health";
import { activeTemplates, templateDrafts } from "@/lib/domain/template-store";
import {
  EDITABLE_TEMPLATE_SLUGS,
  templateSlugOrder,
} from "@/lib/domain/template-slugs";
import { resolveTenantOrgId } from "@/lib/tenant";
import { getAutomationRules } from "@/lib/app-settings";
import { ShellDataWarning } from "@/components/shell-data-warning";

export const dynamic = "force-dynamic";

/**
 * The caller's own template copies and any unpublished drafts on them.
 *
 * This used to select DISTINCT ON (slug) ... ORDER BY version DESC with no
 * org filter, which across tenants means "whoever has saved the most versions
 * wins": a customer opening their Content Library could be shown, and start
 * editing from, another tenant's outreach wording. activeTemplates() is the
 * same resolution the Outreach agent uses, so the editor now shows exactly
 * what would be sent.
 */
async function outreachTemplates(): Promise<{
  templates: EmailTemplate[];
  drafts: Map<string, { version: number; subject: string | null; body: string; draftedAt: string; draftedBy: string | null }>;
}> {
  const orgId = await resolveTenantOrgId();
  const [rows, drafts] = await Promise.all([
    activeTemplates(EDITABLE_TEMPLATE_SLUGS, orgId),
    // Saved edits nobody has published. Loaded here rather than inside the
    // editor so the list can say which templates have one waiting without
    // opening each of them.
    templateDrafts(EDITABLE_TEMPLATE_SLUGS, orgId),
  ]);
  return {
    templates: rows.sort(
      (a, b) => templateSlugOrder(a.slug) - templateSlugOrder(b.slug)
    ),
    drafts,
  };
}

export default async function ContentLibraryPage() {
  const loadWarnings: string[] = [];
  let snippetsUnavailable = false;
  // Who is reading, so the page can say plainly when it is read-only for
  // them rather than letting them fill in a form that will be refused.
  const viewer = await currentUser().catch(() => {
    loadWarnings.push(
      "Your role could not be confirmed, so content editing is disabled."
    );
    return null;
  });

  const [items, outreach, stats, rules] = await Promise.all([
    contentLibrary().catch(() => {
      snippetsUnavailable = true;
      loadWarnings.push(
        "Proposal snippets could not be loaded. Their count is unknown and snippet changes are disabled until this page reloads successfully."
      );
      return [];
    }),
    outreachTemplates(),
    templateSendStats(),
    getAutomationRules(),
  ]);
  const { templates, drafts } = outreach;
  // What each template has actually done, attributed from the send record.
  // A template nobody has used gets zero counts, which the metrics turn into
  // absent rates rather than into a row of noughts.
  const metricsFor = (slug: string) =>
    templateMetrics(
      stats[slug] ?? {
        sent: 0,
        delivered: 0,
        opened: 0,
        replied: 0,
        bounced: 0,
        lastSentAt: null,
      }
    );

  const editable = Boolean(viewer && !viewer.impersonatedBy && can(viewer.orgRole, "manage_content"));
  return (
    <>
      <PageFrame
        help={PAGE_HELP["content"]}
        title="Content Library"
        status={
          snippetsUnavailable
            ? `${templates.length} email template${templates.length === 1 ? "" : "s"} · snippet status unavailable`
            : items.length
            ? `${items.length} snippet${items.length === 1 ? "" : "s"} · ${templates.length} email template${templates.length === 1 ? "" : "s"}`
            : `${templates.length} email template${templates.length === 1 ? "" : "s"}`
        }
        explanation="Edit the email templates and saved text used in your bids."
        breadcrumbs={[{ label: "Settings", href: "/settings" }]}
      />

      <ShellDataWarning items={loadWarnings} />

      {/* Readable at every role; the controls below are gated to the
          roles that can actually change them. */}
      <div className="px-5 pt-4">
        <ReadOnlyBanner role={viewer?.orgRole} capability="manage_content" what="the content library" />
      </div>
      <EditorialTabs
        ariaLabel="Content settings"
        defaultTab="email-templates"
        layout="fill"
        tabs={[
          {
            id: "email-templates",
            /*
             * The count of unpublished drafts, on the tab.
             *
             * Saving no longer sends, which means an edit can sit here
             * unpublished for weeks while the platform keeps using the old
             * wording. Anybody who does not open this tab would never find
             * out, so the tab says it.
             */
            label:
              drafts.size > 0
                ? `Emails to subcontractors (${drafts.size} draft${drafts.size === 1 ? "" : "s"} not published)`
                : "Emails to subcontractors",
            content: (
              <div className="space-y-6 px-5 py-6 sm:px-6">
                <div className="max-w-2xl space-y-2">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {editable ? "Edit the emails sent to subcontractors. Saving creates a draft; your changes are used only after you publish them."
                      : "Review the published wording and saved drafts for emails to subcontractors."}
                  </p>
                  <details className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">How these emails work</summary>
                    <div className="space-y-2 pt-3 leading-relaxed">
                      <p>Names, trades, and dates are filled in for each bid. Project facts,
                        scope, requirements, questions, and document lists are added
                        automatically, so you do not need to paste them in.</p>
                      <p>The first follow-up replies to the original conversation.
                        The second is used only when that conversation cannot be replied
                        to. Each template explains when it is used.</p>
                      <p>The published version stays in use while you work on a draft.</p>
                    </div>
                  </details>
                </div>
                <TemplateWorkbench
                  editable={editable}
                  entries={templates.map(
                    (t): TemplateEntry => ({
                      template: t,
                      metrics: metricsFor(t.slug),
                      draft: drafts.get(t.slug) ?? null,
                    })
                  )}
                  followupHours={rules.followup_hours}
                />
              </div>
            ),
          },
          {
            id: "snippets",
            label: snippetsUnavailable
              ? "Proposal snippets (status unavailable)"
              : `Proposal snippets (${items.length})`,
            content: (
              <div className="px-5 py-6 sm:px-6">
                {snippetsUnavailable ? (
                  <div role="alert" className="rounded-md border border-review/50 bg-review/10 px-4 py-3 text-sm leading-relaxed text-foreground">
                    Proposal snippets are temporarily unavailable. Existing snippets have not
                    been removed. Reload before adding or changing one, so a failed read cannot
                    lead to a duplicate or overwrite.
                  </div>
                ) : (
                  <ContentLibraryManager items={items} editable={editable} />
                )}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
