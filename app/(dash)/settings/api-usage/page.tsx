import { PageFrame } from "@/components/page-frame";
import { ApiUsageLedger } from "@/components/api-usage-ledger";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <>
      <PageFrame
        breadcrumbs={[{ label: "Settings" }]}
        title="AI usage"
        explanation="See your usage and manage connected API accounts."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <ApiUsageLedger />
      </div>
    </>
  );
}
