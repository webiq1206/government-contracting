import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  listPlatformGrants,
  grantPlatformKey,
  revokePlatformKey,
} from "@/lib/integration-keys";
import { ALLOWED_ENV_KEYS, isAllowedKey } from "@/lib/integration-settings";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lend a platform API key to one organization, or take it back.
 *
 * Platform-admin only, and that gate is the whole security model here: a grant
 * spends our money on someone else's behalf. It is deliberately not something
 * a customer can request through the product, because the answer is normally
 * "bring your own key" and the exceptions are ours to make.
 *
 * Every grant and revocation is logged with the administrator's address.
 */
export async function GET() {
  const admin = await requirePlatformAdmin();
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json({ grants: await listPlatformGrants(), keys: ALLOWED_ENV_KEYS });
}

export async function POST(req: Request) {
  const admin = await requirePlatformAdmin();
  if (admin instanceof NextResponse) return admin;

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: string;
    key?: string;
    note?: string;
    expiresAt?: string | null;
    revoke?: boolean;
  };

  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    return NextResponse.json({ error: "Pick an organization." }, { status: 400 });
  }
  if (!isAllowedKey(key)) {
    return NextResponse.json({ error: "That is not a manageable key." }, { status: 400 });
  }

  if (body.revoke) {
    await revokePlatformKey(orgId, key);
    await logAgent({
      agent: "operator",
      action: "platform-key-revoked",
      level: "info",
      message: `${admin.email} revoked the platform ${key} from organization ${orgId}.`,
    });
    return NextResponse.json({ ok: true, revoked: true });
  }

  // An expiry is optional but encouraged: a grant given for a demo that nobody
  // remembers to revoke is how a courtesy becomes a standing bill.
  let expiresAt: string | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That expiry date could not be read." }, { status: 400 });
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "That expiry is in the past, so the grant would do nothing." },
        { status: 400 }
      );
    }
    expiresAt = parsed.toISOString();
  }

  await grantPlatformKey({
    orgId,
    key,
    grantedBy: admin.id === "env-operator" ? null : admin.id,
    note: body.note?.trim() || null,
    expiresAt,
  });

  await logAgent({
    agent: "operator",
    action: "platform-key-granted",
    level: "warn",
    message:
      `${admin.email} lent the platform ${key} to organization ${orgId}` +
      `${expiresAt ? ` until ${expiresAt}` : " with no expiry"}` +
      `${body.note?.trim() ? `, reason: ${body.note.trim()}` : ""}. ` +
      `Usage on this key is billed to us.`,
  });

  return NextResponse.json({ ok: true });
}
