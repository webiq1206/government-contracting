import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("proposal-compliance-matrix");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/proposal-compliance-matrix");
export default function Page() { return <ContractorGuidePage slug="proposal-compliance-matrix" />; }
