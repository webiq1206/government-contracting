import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { contractRecord } from "@/lib/contract-record";
import { VIEW_LABEL } from "@/lib/domain/contract-status";
import { ContractDetail, contractViewOf } from "@/components/contract-detail";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { assignableMembers, ownerOf } from "@/lib/ownership";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";

export const dynamic = "force-dynamic";

/**
 * One contract, on its own page.
 *
 * There was no route for a contract at all. Everything lived as a card in a
 * list, which meant a contract could not be linked to, could not be reached
 * from search, and could never hold more than card-sized detail. The five
 * things a live federal contract actually accumulates after award had nowhere
 * to be shown because they had nowhere to be recorded.
 */
export default async function ContractPage({ params }: { params: { id: string } }) {
  const orgId = (await tryResolveTenantOrgId()) ?? "";
  const record = await contractRecord(orgId, params.id);
  if (!record) notFound();

  const { header: h, money } = record;
  const viewer = await currentUser().catch(() => null);
  const canEdit = can(viewer?.orgRole, "manage_contracts");
  const [teamMembers, owner] = await Promise.all([
    assignableMembers().catch(() => []),
    ownerOf("contract", params.id).catch(() => null),
  ]);

  /*
   * The view label for the header badge. Everything else the record shows --
   * the risks, the plan, the money -- is derived inside ContractDetail, which
   * is also what the Contracts workspace renders, so the two cannot disagree.
   */
  const view = contractViewOf(record);

  return (
    <div className="flex page-shell">
      <PageFrame
        breadcrumbs={[
          { label: "Contracts", href: "/contracts" },
          { label: h.contract_number ?? "Contract" },
        ]}
        title={h.contract_number ?? h.opportunity_title ?? "Contract"}
        explanation={
          [h.agency, h.opportunity_title].filter(Boolean).join(" · ") ||
          "No agency recorded on the opportunity behind this contract"
        }
        status={
          <span className="flex flex-wrap items-center gap-2">
            <span className="badge bg-surface-raised text-foreground">{VIEW_LABEL[view]}</span>
            {h.created_manually && (
              // Says where the record came from. A contract entered by hand
              // has no bid behind it, and several numbers on this page are
              // absent for that reason rather than by oversight.
              <span className="badge bg-surface-raised text-muted-foreground">Entered by hand</span>
            )}
            {h.solicitation_number && (
              <span className="text-muted-foreground">{h.solicitation_number}</span>
            )}
          </span>
        }
      />

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        <ContractDetail
          record={record}
          owner={owner}
          members={teamMembers}
          viewerId={viewer?.id}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
