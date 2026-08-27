import { PageFrame } from "@/components/page-frame";
import { ReadOnlyBanner } from "@/components/permission-gate";
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
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { getAutomationRules } from "@/lib/app-settings";

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
  const orgId = await tryResolveTenantOrgId();
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
  // Who is reading, so the page can say plainly when it is read-only for
  // them rather than letting them fill in a form that will be refused.
  const viewer = await currentUser().catch(() => null);

  const [items, outreach, stats, rules] = await Promise.all([
    contentLibrary(),
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

  return (
    <>
      <PageFrame
        help={PAGE_HELP["content"]}
        title="Content Library"
        status={
          items.length
            ? `${items.length} snippet${items.length === 1 ? "" : "s"} · ${templates.length} email template${templates.length === 1 ? "" : "s"}`
            : `${templates.length} email template${templates.length === 1 ? "" : "s"}`
        }
        explanation="The language this platform reuses: the emails it sends to subcontractors, and the short paragraphs it drafts into bids."
        breadcrumbs={[{ label: "Settings", href: "/settings" }]}
      />

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
                <div className="max-w-2xl">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    These are the outreach and follow-up emails Brost Co sends when it
                    contacts subcontractors. Use fill-in fields for names, trades, and
                    dates; they are filled per bid. Everything factual, the project,
                    the scope, the requirements, the questions and the document list,
                    is added automatically beneath what you write, so you do not need
                    to paste any of it in.
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    There are two follow-up bodies because there are two situations.
                    The first is a reply inside the original conversation, where the
                    scope is already sitting above it. The second is used only when
                    that conversation cannot be replied to, and has to stand on its
                    own. Each one says when it is used.
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Saving writes a draft. Nothing you save is sent to anybody
                    until you publish it, and until then this platform keeps
                    using the version already in use.
                  </p>
                </div>
                <TemplateWorkbench
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
            label: `Proposal snippets (${items.length})`,
            content: (
              <div className="px-5 py-6 sm:px-6">
                <ContentLibraryManager items={items} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
