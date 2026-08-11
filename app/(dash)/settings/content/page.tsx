import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ContentLibraryManager } from "@/components/content-library-manager";
import { EditorialTabs } from "@/components/editorial-tabs";
import { contentLibrary } from "@/lib/data";
import { CONTENT_CATEGORIES } from "@/lib/domain/content";

export const dynamic = "force-dynamic";

export default async function ContentLibraryPage() {
  const items = await contentLibrary();

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
          ariaLabel="Content categories"
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
          ]}
        />
      </div>
    </>
  );
}
