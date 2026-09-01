import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /automation was an old name for Automation Health. Bookmarks and typed
 * URLs landed on a signed-in 404 while the live page sat at /agents.
 */
export default function AutomationAliasPage() {
  redirect("/agents");
}
