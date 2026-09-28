import { FreeToolPage } from "@/components/marketing/free-tool-page";
import { ComplianceMatrix } from "@/components/marketing/free-tools";
import { publicMetadata } from "@/lib/marketing/metadata";
export const metadata = publicMetadata("Free proposal compliance matrix template", "Build a requirements checklist with source references, owners and review status. Export a free CSV for your proposal team.", "/tools/compliance-matrix");
export default function Page() { return <FreeToolPage slug="compliance-matrix"><ComplianceMatrix /></FreeToolPage>; }
