import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("sam-gov-opportunity-search");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/sam-gov-opportunity-search");
export default function Page() { return <ContractorGuidePage slug="sam-gov-opportunity-search" />; }
