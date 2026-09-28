import { FreeToolPage } from "@/components/marketing/free-tool-page";
import { CapabilityBuilder } from "@/components/marketing/free-tools";
import { publicMetadata } from "@/lib/marketing/metadata";
export const metadata = publicMetadata("Free capability statement builder", "Build an editable capability statement from your verified company details. Free, private in your browser, and no signup required.", "/tools/capability-statement");
export default function Page() { return <FreeToolPage slug="capability-statement"><CapabilityBuilder /></FreeToolPage>; }
