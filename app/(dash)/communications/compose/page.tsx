import Link from "next/link";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { rejectOrgPageResponse } from "@/lib/org-page-guard";
import { projectMessageTarget } from "@/lib/project-message";
import { resolveOutreachSender } from "@/lib/domain/sender-identity";
import { UUID } from "@/lib/communications-ledger";
import { ProjectMessageComposer } from "@/components/project-message-composer";
export const dynamic = "force-dynamic";
export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) rejectOrgPageResponse(ctx);
  const params = await searchParams;
  const sub = typeof params.sub === "string" ? params.sub : "";
  const project = typeof params.project === "string" ? params.project : "";
  const trade = typeof params.trade === "string" ? params.trade : "";
  if (!UUID.test(sub) || !UUID.test(project)) notFound();
  const target = await projectMessageTarget(ctx.orgId, sub, project, trade);
  if (!target) notFound();
  const sender = await resolveOutreachSender(ctx.orgId);
  return <main className="page-shell overflow-y-auto p-5"><div className="mx-auto w-full max-w-3xl space-y-5">
    <Link className="text-sm text-accent" href={`/subs/${sub}`}>Back to {target.company_name}</Link>
    <h1 className="text-2xl font-semibold">Compose project message</h1>
    <p className="text-sm"><Link href={`/opportunity/${project}`} className="text-accent">{target.title}</Link>{trade && ` · ${trade}`}</p>
    <ProjectMessageComposer subId={sub} projectId={project} trade={trade} recipient={target.email ?? ""} sender={sender.from}
      ready={!!target.email && target.email_verified && sender.connected && !sender.unknown} />
  </div></main>;
}
