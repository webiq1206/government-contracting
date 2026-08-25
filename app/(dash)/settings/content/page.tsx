import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ContentLibraryManager } from "@/components/content-library-manager";
import { EmailTemplateEditor, type EmailTemplate } from "@/components/email-template-editor";
import { EditorialTabs } from "@/components/editorial-tabs";
import { contentLibrary } from "@/lib/data";
import { activeTemplates } from "@/lib/domain/template-store";
import { tryResolveTenantOrgId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * The caller's own template copies, falling back to the platform defaults.
 *
 * This used to select DISTINCT ON (slug) ... ORDER BY version DESC with no
 * org filter, which across tenants means "whoever has saved the most versions
 * wins": a customer opening their Content Library could be shown, and start
 * editing from, another tenant's outreach wording. activeTemplates() is the
 * same resolution the Outreach agent uses, so the editor now shows exactly
 * what would be sent.
 */
async function activeOutreachTemplates(): Promise<EmailTemplate[]> {
  const orgId = await tryResolveTenantOrgId();
  const rows = await activeTemplates(
    [
      "template_1_outreach",
      "template_2_followup",
      // The fallback body, shown next to the one it backs up. An operator
      // editing follow-up wording needs to see both, because whichever one
      // they miss is the one a subcontractor eventually reads.
      "template_2_followup_new_thread",
    ],
    orgId
  );
  // Initial outreach first, then the in-thread follow-up, then its fallback:
  // the order they occur in, which is also the order they matter in.
  const ORDER = [
    "template_1_outreach",
    "template_2_followup",
    "template_2_followup_new_thread",
  ];
  return rows.sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));
}

export default async function ContentLibraryPage() {
  const [items, templates] = await Promise.all([
    contentLibrary(),
    activeOutreachTemplates(),
  ]);

  return (
    <>
      <PageHeader
        help={PAGE_HELP["content"]}
        title="Content Library"
        status={
          items.length
            ? `${items.length} snippet${items.length === 1 ? "" : "s"} · ${templates.length} email template${templates.length === 1 ? "" : "s"}`
            : `${templates.length} email template${templates.length === 1 ? "" : "s"}`
        }
        subtitle="Two places to store language Brost Co reuses: emails it sends to subcontractors, and short proposal paragraphs it drafts into bids."
      />
      <EditorialTabs
        ariaLabel="Content settings"
        defaultTab="email-templates"
        layout="fill"
        tabs={[
          {
            id: "email-templates",
            label: "Emails to subcontractors",
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
                    own. Each one below says when it is used.
                  </p>
                </div>
                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active outreach templates found in the database.
                  </p>
                ) : (
                  <div className="space-y-8">
                    {templates.map((t) => (
                      <EmailTemplateEditor key={t.slug} template={t} />
                    ))}
                  </div>
                )}
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
