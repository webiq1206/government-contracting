import { FreeToolPage } from "@/components/marketing/free-tool-page";
import { ComplianceMatrix } from "@/components/marketing/free-tools";
import { publicMetadata } from "@/lib/marketing/metadata";
export const metadata = publicMetadata("Free proposal compliance matrix: 5 fields", "Track 5 fields per proposal requirement, then export up to 100 rows as CSV. Free to use in your browser with no account.", "/tools/compliance-matrix");
export default function Page() { return <FreeToolPage slug="compliance-matrix"><ComplianceMatrix /></FreeToolPage>; }
