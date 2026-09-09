import { notFound, redirect } from "next/navigation";

/** Pages must render UI or navigate, never return an API response object. */
export function rejectOrgPageResponse(response: Response): never {
  if (response.status === 401) redirect("/login");
  if (response.status === 402) redirect("/settings/billing");
  if (response.status === 403 || response.status === 404) notFound();
  throw new Error("Your account could not be loaded. Please try again.");
}
