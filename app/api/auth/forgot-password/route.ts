import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth-password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Each accepted call can send an email; without a cap this is a spam pump. */
const RESET_RULE = { limit: 5, windowMs: 15 * 60 * 1000 };

export async function POST(req: Request) {
  const { consume, clientIp } = await import("@/lib/rate-limit");
  const gate = consume("auth-forgot", clientIp(req), RESET_RULE);
  // Deliberately still { ok: true }: this endpoint never confirms whether an
  // email exists, and a 429 would leak that the caller found a live form.
  if (!gate.ok) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  await requestPasswordReset(body.email ?? "");
  return NextResponse.json({ ok: true });
}
