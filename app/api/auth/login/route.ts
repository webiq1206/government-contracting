import { NextResponse } from "next/server";
import { authenticate, createSession, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * In-memory brute-force throttle. Single-operator phase, single instance, a
 * pg-backed counter is overkill; this stops trivial credential stuffing without
 * new infra. 10 failures per (ip+email) inside 10 minutes locks the pair out for
 * 10 minutes. A successful login clears the counter.
 */
const MAX_FAILURES = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function recordFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.lockedUntil) {
    attempts.set(key, { count: 1, lockedUntil: now + WINDOW_MS });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) rec.lockedUntil = now + WINDOW_MS;
}

function isLocked(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() > rec.lockedUntil) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= MAX_FAILURES;
}

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const key = `${clientIp(req)}|${String(email).toLowerCase().trim()}`;
  if (isLocked(key)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }
  // An exception here is not a rejected password, it is authentication failing
  // to run at all (the database being unreachable is the one that has actually
  // happened). Reporting that as "Invalid email or password" sent the owner
  // hunting for a password that was never wrong, while the real fault was a
  // deployment that could not reach its database. Keep the two apart: a bad
  // password is the user's problem to fix, an outage is ours, and only the
  // former should count toward the lockout.
  let authError: unknown = null;
  const user = await authenticate(String(email), String(password)).catch((err) => {
    authError = err;
    return null;
  });
  if (authError) {
    console.error("[login] sign-in could not be completed:", authError);
    return NextResponse.json(
      {
        error:
          "Sign-in is temporarily unavailable, so we could not check your password. This is a problem on our side, not with your login. Please try again in a few minutes.",
      },
      { status: 503 }
    );
  }
  if (!user) {
    recordFailure(key);
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
  attempts.delete(key); // reset on success
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, user: { email: user.email, role: user.role } });
}
