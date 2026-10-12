import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { readAiReconciliation } from "@/lib/admin/ai-reconciliation";

export const dynamic = "force-dynamic";

/** Read-only founding-account reconciliation inventory. No settlement action. */
export async function GET() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json(await readAiReconciliation(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Reconciliation inventory could not be established. No holds or spending settings were changed." }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
