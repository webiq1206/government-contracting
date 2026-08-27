import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { logAgent } from "@/lib/logger";
import {
  CapabilityRefusal,
  removeContact,
  removeLicense,
  saveCapability,
  saveContact,
  saveLicense,
} from "@/lib/sub-capability-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a firm can take on, the people at it, and its licences.
 *
 * One route because these are one editing session on one record: an estimator
 * finishing a call types the crew size, the person who priced it and the
 * licence number in the same two minutes, and splitting them across three
 * endpoints would only mean three ways for half of it to save.
 *
 * Body: `{ action: "capability", fields }`, `{ action: "contact", ... }`,
 * `{ action: "remove_contact", contact_id }`, `{ action: "license", ... }`, or
 * `{ action: "remove_license", license_id }`.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_subs" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "capability": {
        const fields = (body.fields ?? {}) as Record<string, unknown>;
        const res = await saveCapability({
          orgId: ctx.orgId,
          subcontractorId: params.id,
          actorId: ctx.user.id,
          fields,
        });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
        await logAgent({
          agent: "operator",
          action: "sub-capability-saved",
          subcontractorId: params.id,
          level: "info",
          // Names the fields rather than saying "updated": a log line that does
          // not say what changed cannot answer the question it is read for.
          message: `Updated what this firm can take on: ${Object.keys(fields).join(", ") || "nothing"}.`,
        });
        return NextResponse.json({ ok: true, message: "Saved." });
      }

      case "contact": {
        const res = await saveContact({
          orgId: ctx.orgId,
          subcontractorId: params.id,
          contactId: (body.contact_id as string | undefined) ?? null,
          name: String(body.name ?? ""),
          role: String(body.role ?? ""),
          email: (body.email as string | undefined) ?? null,
          phone: (body.phone as string | undefined) ?? null,
          isPrimary: Boolean(body.is_primary),
          note: (body.note as string | undefined) ?? null,
        });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
        return NextResponse.json({ ok: true, id: res.id, message: "Saved." });
      }

      case "remove_contact": {
        const res = await removeContact({
          orgId: ctx.orgId,
          subcontractorId: params.id,
          contactId: String(body.contact_id ?? ""),
        });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
        return NextResponse.json({ ok: true, message: "Removed." });
      }

      case "license": {
        const res = await saveLicense({
          orgId: ctx.orgId,
          subcontractorId: params.id,
          trade: String(body.trade ?? ""),
          jurisdiction: (body.jurisdiction as string | undefined) ?? null,
          number: (body.number as string | undefined) ?? null,
          status: (body.status as string | undefined) ?? null,
          expiresAt: (body.expires_at as string | undefined) ?? null,
          source: "operator",
        });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
        return NextResponse.json({ ok: true, message: "Saved." });
      }

      case "remove_license": {
        const res = await removeLicense({
          orgId: ctx.orgId,
          subcontractorId: params.id,
          licenseId: String(body.license_id ?? ""),
        });
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
        return NextResponse.json({ ok: true, message: "Removed." });
      }

      default:
        return NextResponse.json({ error: "That is not something to do here." }, { status: 400 });
    }
  } catch (e) {
    // A constraint the database caught first still reaches the operator as a
    // sentence rather than as a constraint name.
    if (e instanceof CapabilityRefusal) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
