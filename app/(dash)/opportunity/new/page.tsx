import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";
import { PageFrame } from "@/components/page-frame";
import { ReadOnlyBanner } from "@/components/permission-gate";
import { AddSolicitationForm } from "@/components/add-solicitation-form";

export const dynamic = "force-dynamic";

/**
 * Add a solicitation somebody found outside the platform.
 *
 * The monitor finds what SAM.gov posts under the account's codes. This is
 * for everything else: a state portal, an agency email, a PDF handed over
 * at a site visit. The record it creates is an ordinary opportunity that
 * gets scored, analysed, priced and tracked like any other.
 */
export default async function NewOpportunityPage() {
  const viewer = await currentUser();
  const allowed = can(viewer?.orgRole, "decide");
  return (
    <div className="page-shell">
      <PageFrame
        title="Add a solicitation"
        breadcrumbs={[{ label: "Opportunities", href: "/pipeline" }, { label: "Add a solicitation" }]}
        explanation="Paste a link, upload the documents, or type the essentials. Brost Co reads what it can, shows where each detail came from, and then treats the record like any opportunity it found itself."
      />
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6">
        {!allowed && (
          <ReadOnlyBanner
            capability="decide"
            role={viewer?.orgRole}
            what="add opportunities"
          />
        )}
        <AddSolicitationForm canSave={allowed} />
      </div>
    </div>
  );
}
