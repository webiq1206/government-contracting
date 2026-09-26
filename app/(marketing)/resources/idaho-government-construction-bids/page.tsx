import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("idaho-government-construction-bids");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/idaho-government-construction-bids");
export default function Page() { return <ContractorGuidePage slug="idaho-government-construction-bids" />; }
