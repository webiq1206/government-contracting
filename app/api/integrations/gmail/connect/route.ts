import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getAuthUrl } from "@/lib/integrations/gmail";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start the Gmail OAuth consent flow. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  if (!config.gmail.configured) {
    return NextResponse.json(
      { error: "Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first." },
      { status: 400 }
    );
  }
  return NextResponse.redirect(getAuthUrl());
}
