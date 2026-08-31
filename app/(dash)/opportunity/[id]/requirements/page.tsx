import Link from "next/link";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { PageFrame } from "@/components/page-frame";
import { EmptyState } from "@/components/empty-state";
import { requireOrgContext } from "@/lib/org-guard";
import { can } from "@/lib/domain/roles";
import { opportunityDetail } from "@/lib/data";
import { assignableMembers } from "@/lib/ownership";
import { requirementViews } from "@/lib/requirement-states";
import { briefInputFrom, buildOpportunityBrief } from "@/lib/domain/opportunity-brief";
import { describeDocument, toDocumentRecord, sortForReview } from "@/lib/domain/document-inventory";
import {
  RequirementsWorkspace,
  type RequirementDoc,
} from "@/components/requirements-workspace";
import type { SolicitationAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The submission checklist, worked against the solicitation itself.
 *
 * Its own route rather than a fourth pane inside the record's tabs, for one
 * structural reason: three panes need a bounded height to scroll inside, and
 * the record page is a single tall scroller with a sticky tab bar. Nesting a
 * 70vh scroll region inside it would trap the wheel and give the document a
 * third of the screen it needs most.
 *
 * So this is the same move the compliance board makes: the record keeps the
 * checklist as a list, and a button opens the version you work in. The
 * breadcrumb goes straight back.
 */
export default async function RequirementsPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const detail = await opportunityDetail(params.id);
  if (!detail) notFound();

  const { opp, documents } = detail;
  const analysis = opp.solicitation_analysis as SolicitationAnalysis | null;
  const brief = analysis ? buildOpportunityBrief(briefInputFrom(analysis)) : null;
  const requirements = brief?.requirements ?? [];

  const [tracking, members] = await Promise.all([
    requirements.length > 0
      ? requirementViews(
          params.id,
          requirements.map((r) => ({
            id: r.id,
            needsSignature: r.needsSignature,
            producedByPlatform: r.owner === "platform",
          }))
        ).catch(() => null)
      : Promise.resolve(null),
    assignableMembers().catch(() => []),
  ]);

  /*
   * Only the solicitation documents, and only the ones a browser will draw.
   *
   * A generated bid PDF is not a source: checking a requirement against the
   * package we produced from it would be checking our own homework. And a Word
   * attachment renders as nothing at all, so offering it in the picker would
   * be a choice that blanks the pane.
   */
  const readable: RequirementDoc[] = sortForReview(
    (documents as Record<string, unknown>[])
      .filter((d) => String(d.kind) === "solicitation")
      .map((d) => describeDocument(toDocumentRecord(d)))
  )
    .filter((d) => d.preview !== "none")
    .map((d) => ({
      id: d.id,
      name: d.name,
      preview: d.preview as RequirementDoc["preview"],
      pageCount: d.pageCount,
    }));

  const recordHref = `/opportunity/${params.id}#requirements`;
  const title = opp.title ?? "Untitled opportunity";

  return (
    <div className="flex page-shell">
      <PageFrame
        breadcrumbs={[
          { label: "Opportunities", href: "/pipeline" },
          { label: title, href: `/opportunity/${params.id}` },
          { label: "Requirements" },
        ]}
        title="What it takes to bid"
        explanation="Every submission requirement, with the part of the solicitation it was read from open beside it."
        status={
          requirements.length === 0
            ? "Nothing extracted yet"
            : `${requirements.length} requirement${requirements.length === 1 ? "" : "s"}${
                brief && brief.disqualifiers.length > 0
                  ? ` · ${brief.disqualifiers.length} can sink the bid`
                  : ""
              }`
        }
        primaryAction={
          <Link href={recordHref} className="btn-ghost text-xs">
            Back to the record
          </Link>
        }
      />

      {requirements.length === 0 ? (
        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          <EmptyState
            title="No submission requirements were extracted"
            description="Until the analysis finishes, the original solicitation is the source of truth for what has to be submitted. The Files tab on the record holds everything that arrived."
            action={
              <Link href={recordHref} className="btn-ghost text-sm">
                Back to the record
              </Link>
            }
          />
        </div>
      ) : (
        <RequirementsWorkspace
          opportunityId={params.id}
          requirements={requirements}
          states={tracking?.states ?? {}}
          history={tracking?.history ?? {}}
          documents={readable}
          members={members}
          viewerId={ctx.user.id}
          canEdit={can(ctx.user.orgRole, "decide")}
          recordHref={recordHref}
        />
      )}
    </div>
  );
}
