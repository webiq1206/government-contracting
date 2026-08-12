import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ContentLibraryManager } from "@/components/content-library-manager";
import { EmailTemplateEditor, type EmailTemplate } from "@/components/email-template-editor";
import { EditorialTabs } from "@/components/editorial-tabs";
import { contentLibrary } from "@/lib/data";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function activeOutreachTemplates(): Promise<EmailTemplate[]> {
  const rows = await query<EmailTemplate>(
    `SELECT DISTINCT ON (slug) id, slug, version, subject, body, description
       FROM templates
      WHERE slug IN ('template_1_outreach', 'template_2_followup') AND is_active = true
      ORDER BY slug, version DESC`
  );
  // Sort: outreach first, followup second.
  return rows.sort((a: EmailTemplate, b: EmailTemplate) =>
    a.slug.localeCompare(b.slug)
  );
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
                    deadlines (they update per bid). Select text in the body to bold,
                    highlight, or turn lines into bullets.
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
