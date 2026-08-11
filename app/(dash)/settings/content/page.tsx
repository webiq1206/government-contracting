import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { ContentLibraryManager } from "@/components/content-library-manager";
import { contentLibrary } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ContentLibraryPage() {
  const items = await contentLibrary();

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["content"]}
        title="Content Library"
        subtitle={
          items.length
            ? `${items.length} snippet${items.length === 1 ? "" : "s"}`
            : "Reusable, pre-approved language the automation drafts from"
        }
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <ContentLibraryManager items={items} />
      </div>
    </div>
  );
}
