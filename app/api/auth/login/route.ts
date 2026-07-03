import { NextResponse } from "next/server";
import { authenticate, createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const user = await authenticate(String(email), String(password)).catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, user: { email: user.email, role: user.role } });
}
