import { NextResponse } from "next/server";
import { resetPasswordWithToken } from "@/lib/auth-password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };
  try {
    const result = await resetPasswordWithToken({
      token: body.token ?? "",
      password: body.password ?? "",
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] transaction failed:", err);
    return NextResponse.json(
      {
        error:
          "Your password was not changed because the account service is unavailable. Check your connection and try this link again. If it continues, request a new reset link or contact support.",
      },
      { status: 503 }
    );
  }
}
