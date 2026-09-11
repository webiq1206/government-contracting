import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { PageFrame } from "@/components/page-frame";
import { UsageBillingControls } from "@/components/usage-billing-controls";
import { ApiUsageLedger } from "@/components/api-usage-ledger";
export const dynamic = "force-dynamic";
export default async function Page() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) notFound();
  return (
    <>
      <PageFrame
        breadcrumbs={[{ label: "Platform admin" }]}
        title="AI usage"
        explanation="Track service costs and tenant charges."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <ApiUsageLedger admin />
        <details className="card mt-5"><summary className="cursor-pointer font-semibold">Reconciliation and billing</summary><UsageBillingControls /></details>
      </div>
    </>
  );
}
