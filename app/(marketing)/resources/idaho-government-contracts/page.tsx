import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("idaho-government-contracts");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/idaho-government-contracts");
export default function Page() { return <ContractorGuidePage slug="idaho-government-contracts" />; }
