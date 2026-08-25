import { NextResponse } from "next/server";
import { requireUser, requireCapability } from "@/lib/api-auth";
import {
  hydrateIntegrationEnv,
  settingSources,
  saveSetting,
  deleteSetting,
  isAllowedKey,
} from "@/lib/integration-settings";
import { INTEGRATION_DEFS } from "@/lib/integration-defs";
import { recentAiTrouble, troubleSummary } from "@/lib/integration-health";
import { gmail } from "@/lib/integrations/gmail";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assemble() {
  await hydrateIntegrationEnv();
  const sources = await settingSources();
  const gmailConnected = await gmail.isConnected().catch(() => false);
  // A stored key says nothing about whether the service behind it still
  // answers. This is what happened when we last used it.
  const aiTrouble = await recentAiTrouble().catch(() => ({ count: 0, reason: null }));
  return INTEGRATION_DEFS.map((def) => {
    const fields = def.fields.map((f) => ({
      ...f,
      ...(sources[f.env] ?? { source: "none", masked: null }),
    }));
    const required = fields.filter((f) => !f.label.includes("optional"));
    const configured =
      def.id === "usaspending" ||
      (required.length > 0 && required.every((f) => f.source !== "none"));
    const lastError =
      (def.id === "claude" ? troubleSummary(aiTrouble) : null) ??
      fields.map((f) => f.last_error).find(Boolean) ??
      null;
    const lastValidated =
      fields
        .map((f) => f.last_validated_at)
        .filter(Boolean)
        .sort()
        .pop() ?? null;
    return {
      ...def,
      fields,
      configured: def.id === "gmail" ? gmailConnected || configured : configured,
      gmailConnected: def.id === "gmail" ? gmailConnected : undefined,
      last_error: lastError,
      last_validated_at: lastValidated,
    };
  });
}

/** List every integration with status, sources, and masked values. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ integrations: await assemble() });
}

/**
 * Save and/or remove integration values.
 * Body: { values?: Record<envKey, string>, remove?: envKey[] }
 */
export async function POST(req: Request) {
  const auth = await requireCapability("manage_integrations");
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as {
    values?: Record<string, string>;
    remove?: string[];
  };

  const saved: string[] = [];
  const removed: string[] = [];
  for (const [key, value] of Object.entries(body.values ?? {})) {
    if (!isAllowedKey(key)) {
      return NextResponse.json(
        { error: `"${key}" can't be managed from this page.` },
        { status: 400 }
      );
    }
    const v = String(value ?? "").trim();
    if (!v) continue;
    if (v.length > 4096) {
      return NextResponse.json({ error: `Value for ${key} is too long.` }, { status: 400 });
    }
    await saveSetting(key, v);
    saved.push(key);
  }
  for (const key of body.remove ?? []) {
    if (!isAllowedKey(key)) continue;
    await deleteSetting(key);
    removed.push(key);
  }

  if (saved.length || removed.length) {
    await logAgent({
      agent: "operator",
      action: "integrations-updated",
      level: "info",
      message: `Integration settings changed by ${auth.email}: ${[
        saved.length ? `saved ${saved.join(", ")}` : null,
        removed.length ? `removed ${removed.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; ")}. (Values are never logged.)`,
    });
  }

  return NextResponse.json({ ok: true, saved, removed, integrations: await assemble() });
}
