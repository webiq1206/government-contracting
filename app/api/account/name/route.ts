import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Change your own display name.
 *
 * Scoped to the signed-in user's own id, with no way to name another: this is
 * the one settings endpoint that is about a person rather than an
 * organization, and an account owner editing a teammate belongs behind
 * manage_team, not here.
 *
 * The email address is deliberately not editable. It is the login identity,
 * the address outreach threads are matched back to, and the key the alias
 * table joins on, so changing it is an operation with consequences elsewhere
 * rather than a text field.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const raw = typeof body?.name === "string" ? body.name.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "Enter the name you want shown." }, { status: 400 });
  }
  if (raw.length > 120) {
    return NextResponse.json({ error: "That name is too long." }, { status: 400 });
  }

  await query(`update users set name = $2 where id = $1`, [auth.id, raw]);
  return NextResponse.json({ ok: true, name: raw });
}
