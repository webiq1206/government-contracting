import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { contractorGuide } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

const guide = contractorGuide("boise-government-bids");
export const metadata = publicMetadata(guide.title, guide.description, "/resources/boise-government-bids");
export default function Page() { return <ContractorGuidePage slug="boise-government-bids" />; }
