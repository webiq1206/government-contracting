import { NextResponse } from "next/server";
import {
  createSession,
  hasAnyOperator,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time first-run operator bootstrap. Creates the initial operator when the
 * users table is empty. Refuses (409) if any operator already exists — so this
 * endpoint can't be used to add or overwrite users later. Called from /setup.
 */
export async function POST(req: Request) {
  if (await hasAnyOperator()) {
    return NextResponse.json({ error: "Setup already complete." }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");
  const name = body.name ? String(body.name).trim() : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (password.length < 12) {
    return NextResponse.json(
      { error: "Password must be at least 12 characters." },
      { status: 400 }
    );
  }

  const user = await queryOne<{ id: string; email: string }>(
    `insert into users (email, password_hash, name, role) values ($1, $2, $3, 'operator')
     on conflict (email) do nothing
     returning id, email`,
    [email, hashPassword(password), name]
  );
  if (!user) {
    // A concurrent bootstrap already claimed the address.
    return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
  }

  // Log the operator in immediately.
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, user: { email: user.email, role: "operator" } });
}
