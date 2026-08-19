import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth-password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Each accepted call can send an email; without a cap this is a spam pump. */
const RESET_RULE = { limit: 5, windowMs: 15 * 60 * 1000 };

/**
 * `delivered` says whether a link actually went out. It is false whenever
 * nothing was sent, for any reason: no mail transport, a throttled caller, or a
 * failure inside the request. None of those depend on the address, so the
 * answer gives away nothing about who has an account, and it is the difference
 * between someone waiting on a link that will never arrive and someone who
 * knows to find another way in.
 *
 * Everything stays 200 with ok:true. A different status for a known address is
 * exactly the tell this endpoint must not have.
 */
export async function POST(req: Request) {
  const { consume, clientIp } = await import("@/lib/rate-limit");
  const gate = consume("auth-forgot", clientIp(req), RESET_RULE);
  if (!gate.ok) return NextResponse.json({ ok: true, delivered: false });

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  try {
    const result = await requestPasswordReset(body.email ?? "");
    return NextResponse.json({ ok: true, delivered: result.delivery === "sent" });
  } catch (err) {
    // The database being unreachable is the case that matters: it is exactly
    // when someone is trying to get back in, and it must not answer with
    // "check your email".
    console.error("[forgot-password] reset request failed:", err);
    return NextResponse.json({ ok: true, delivered: false });
  }
}
