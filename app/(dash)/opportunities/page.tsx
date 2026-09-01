import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /opportunities was the old name of the pipeline. Bookmarks, Knowledge
 * Center links, and empty-state buttons still used it after the page moved
 * to /pipeline, so a signed-in operator hit a 404 on the word the nav uses
 * for the same work.
 */
export default function OpportunitiesAliasPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "status" && (value === "archived" || value === "closed")) {
      q.set("closed", "1");
      continue;
    }
    if (typeof value === "string") q.set(key, value);
    else if (Array.isArray(value)) for (const item of value) q.append(key, item);
  }
  const suffix = q.toString();
  redirect(suffix ? `/pipeline?${suffix}` : "/pipeline");
}
