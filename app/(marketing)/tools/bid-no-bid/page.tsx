import { FreeToolPage } from "@/components/marketing/free-tool-page";
import { BidScorecard } from "@/components/marketing/free-tools";
import { publicMetadata } from "@/lib/marketing/metadata";
export const metadata = publicMetadata("Free bid/no-bid scorecard for government contracts", "Evaluate eligibility, deadlines, delivery capacity and bid preparation. Download a free decision worksheet without an account.", "/tools/bid-no-bid");
export default function Page() { return <FreeToolPage slug="bid-no-bid"><BidScorecard /></FreeToolPage>; }
