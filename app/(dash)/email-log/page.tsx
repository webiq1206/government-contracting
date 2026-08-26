import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The old address, kept working.
 *
 * "Email Log" named a list of messages, which is what the page was and is no
 * longer. The page is now Communications, and the URL says so. This redirect
 * exists because links to /email-log are in browser histories, bookmarks and
 * old help text, and a 404 on a URL a person used yesterday is a worse
 * outcome than an extra hop.
 *
 * Search and filter carry across where the old vocabulary has a new
 * equivalent. The three delivery-failure filters collapse into one, because
 * "did not arrive" is what a person is actually asking for and the message
 * state still names which kind it was.
 */
const FILTER_FOR_STATUS: Record<string, string> = {
  bounced: "delivery_failed",
  deferred: "delivery_failed",
  failed: "delivery_failed",
  responded: "needs_reply",
  inbound: "needs_reply",
};

export default function EmailLogRedirect({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string };
}) {
  const params = new URLSearchParams();
  if (searchParams?.q) params.set("q", searchParams.q);
  const mapped = searchParams?.status ? FILTER_FOR_STATUS[searchParams.status] : undefined;
  if (mapped) params.set("filter", mapped);
  const qs = params.toString();
  redirect(qs ? `/communications?${qs}` : "/communications");
}
