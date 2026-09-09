import { PageFrame } from "@/components/page-frame";
import { ActivityLedger } from "@/components/activity-ledger";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <>
      <PageFrame
        title="Activity Ledger"
        explanation="A clear history of your account’s work, communications and outcomes."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-6">
        <ActivityLedger />
      </div>
    </>
  );
}
