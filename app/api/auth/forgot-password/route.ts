import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth-password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  await requestPasswordReset(body.email ?? "");
  return NextResponse.json({ ok: true });
}
