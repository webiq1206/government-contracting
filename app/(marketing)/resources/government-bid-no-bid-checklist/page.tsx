import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("government-bid-no-bid-checklist");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/government-bid-no-bid-checklist");
export default function Page() { return <ContractorGuidePage slug="government-bid-no-bid-checklist" />; }
