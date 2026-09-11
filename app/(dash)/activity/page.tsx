import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readActivity } from "@/lib/activity/read";
import { PageFrame } from "@/components/page-frame";
import { ActivityLedger } from "@/components/activity-ledger";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}: {searchParams: Promise<Record<string,string|string[]|undefined>>}) {
  const user = await currentUser();
  if (!user?.organizationId) redirect("/login");
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key,item));
    else if (value != null) params.set(key,value);
  }
  const initialData = await readActivity(user.organizationId, params)
    .then(data => ({...data,viewScope:user.organizationId+":"+user.id}))
    .catch(() => null);

  return (
    <>
      <PageFrame
        title="Activity"
        explanation="A clear history of your account’s work, communications and outcomes."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-6">
        <ActivityLedger initialData={initialData} initialQuery={params.toString()} />
      </div>
    </>
  );
}
