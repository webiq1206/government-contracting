import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("subcontractor-quote-request-checklist");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/subcontractor-quote-request-checklist");
export default function Page() { return <ContractorGuidePage slug="subcontractor-quote-request-checklist" />; }
