import { notFound, redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

/**
 * /admin used to 404. Every other admin URL is a real page; this one was
 * missing, so a typed-in or bookmarked /admin looked like the product had
 * no admin home.
 */
export default async function AdminIndexPage() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) notFound();
  redirect("/admin/accounts");
}
