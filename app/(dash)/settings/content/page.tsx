import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ContentLibraryManager } from "@/components/content-library-manager";
import { EmailTemplateEditor, type EmailTemplate } from "@/components/email-template-editor";
import { EditorialTabs } from "@/components/editorial-tabs";
import { contentLibrary } from "@/lib/data";
import { query } from "@/lib/db";
import { CONTENT_CATEGORIES } from "@/lib/domain/content";

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
            ? `${items.length} snippet${items.length === 1 ? "" : "s"} saved`
            : "Empty"
        }
        subtitle="Reusable, pre-approved language the automation drafts from for outreach, bids, and follow-ups."
      />
      <div className="scroll-thin flex-1 overflow-y-auto">
        <EditorialTabs
          ariaLabel="Content settings"
          defaultTab="all"
          stickyTopClass="top-[3.25rem]"
          tabs={[
            {
              id: "all",
              label: `All (${items.length})`,
              content: (
                <div className="px-5 py-6 sm:px-6">
                  <ContentLibraryManager items={items} />
                </div>
              ),
            },
            ...CONTENT_CATEGORIES.map((cat) => {
              const filtered = items.filter((i) => i.category === cat.value);
              return {
                id: cat.value,
                label: `${cat.label} (${filtered.length})`,
                content: (
                  <div className="px-5 py-6 sm:px-6">
                    <ContentLibraryManager items={filtered} />
                  </div>
                ),
              };
            }),
            {
              id: "email-templates",
              label: "Email Templates",
              content: (
                <div className="space-y-6 px-5 py-6 sm:px-6">
                  <div className="max-w-2xl">
                    <p className="text-sm leading-relaxed text-slate-600">
                      Customize the emails the automation sends to subcontractors.
                      Click or drag a{" "}
                      <span className="font-medium">token</span> into the subject or
                      body to insert a placeholder — each token is filled with live
                      solicitation data before the email goes out.
                    </p>
                  </div>
                  {templates.length === 0 ? (
                    <p className="text-sm text-slate-500">
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
          ]}
        />
      </div>
    </>
  );
}
