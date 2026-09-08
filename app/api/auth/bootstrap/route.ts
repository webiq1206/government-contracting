import { NextResponse } from "next/server";
import {
  createSession,
  hasAnyOperator,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import { transaction } from "@/lib/db";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time first-run operator bootstrap. Creates the initial operator when the
 * users table is empty. Refuses (409) if any operator already exists, so this
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

  const passwordHash = hashPassword(password);
  const user = await transaction(async (client) => {
    // Only one deployment process may decide that the installation is empty.
    // The transaction-level advisory lock is released automatically at commit
    // or rollback, including when two first-run requests arrive together.
    await client.query(`select pg_advisory_xact_lock(hashtext('brostco-auth-bootstrap'))`);

    const existing = await client.query<{ exists: boolean }>(
      `select exists(select 1 from users) as exists`
    );
    if (existing.rows[0]?.exists) return null;

    const inserted = await client.query<{ id: string; email: string }>(
      `insert into users (email, password_hash, name, role)
       values ($1, $2, $3, 'operator')
       returning id, email`,
      [email, passwordHash, name]
    );
    const created = inserted.rows[0];
    if (!created) throw new Error("Initial account could not be created.");

    // Authentication and membership are one atomic setup operation. A user
    // without this row would sign in successfully and then have no tenant.
    await client.query(
      `insert into organization_members (org_id, user_id, role)
       values ($1, $2, 'owner')`,
      [LEGACY_ORG_ID, created.id]
    );
    return created;
  });
  if (!user) {
    // A concurrent bootstrap completed while this request waited for the
    // lock. Do not reveal which address claimed the installation.
    return NextResponse.json({ error: "Setup already complete." }, { status: 409 });
  }

  // Log the operator in immediately.
  const token = await createSession(user.id, req.headers.get("user-agent"));
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, user: { email: user.email, role: "operator" } });
}
