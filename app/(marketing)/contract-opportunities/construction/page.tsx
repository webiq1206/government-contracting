import { OpportunitySector } from "@/components/marketing/opportunity-sector";
import { OPPORTUNITY_SECTORS } from "@/lib/marketing/opportunity-sectors";
import { publicMetadata } from "@/lib/marketing/metadata";
const sector = OPPORTUNITY_SECTORS.find(s => s.slug === "construction")!;
export const metadata = publicMetadata(sector.title, sector.description, "/contract-opportunities/construction");
export default function Page() { return <OpportunitySector slug="construction" />; }
